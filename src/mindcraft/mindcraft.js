import { createMindServer, registerAgent, registerWorker, numStateListeners } from './mindserver.js';
import { AgentProcess } from '../process/agent_process.js';
import { WorkerProcess } from '../process/worker_process.js';
import { getServer } from './mcserver.js';
import open from 'open';
import { readFileSync, existsSync } from 'fs';

let mindserver;
let connected = false;
let agent_processes = {};
let worker_processes = {};
let agent_count = 0;
let worker_count = 0;
let mindserver_port = 8080;

export async function init(host_public=false, port=8080, auto_open_ui=true) {
    if (connected) {
        console.error('Already initiliazed!');
        return;
    }
    mindserver = createMindServer(host_public, port);
    mindserver_port = port;
    connected = true;
    if (auto_open_ui) {
        setTimeout(() => {
            // check if browser listener is already open
            if (numStateListeners() === 0) {
                open('http://localhost:'+port);
            }
        }, 3000);
    }
}

export async function createAgent(settings) {
    if (!settings.profile.name) {
        console.error('Agent name is required in profile');
        return {
            success: false,
            error: 'Agent name is required in profile'
        };
    }
    settings = JSON.parse(JSON.stringify(settings));
    let agent_name = settings.profile.name;
    const agentIndex = agent_count++;
    const viewer_port = 3000 + agentIndex;
    registerAgent(settings, viewer_port);
    let load_memory = settings.load_memory || false;
    let init_message = settings.init_message || null;

    try {
        try {
            const server = await getServer(settings.host, settings.port, settings.minecraft_version);
            settings.host = server.host;
            settings.port = server.port;
            settings.minecraft_version = server.version;
        } catch (error) {
            console.warn(`Error getting server:`, error);
            if (settings.minecraft_version === "auto") {
                settings.minecraft_version = null;
            }
            console.warn(`Attempting to connect anyway...`);
        }

        const agentProcess = new AgentProcess(agent_name, mindserver_port);
        agentProcess.start(load_memory, init_message, agentIndex);
        agent_processes[settings.profile.name] = agentProcess;
    } catch (error) {
        console.error(`Error creating agent ${agent_name}:`, error);
        destroyAgent(agent_name);
        return {
            success: false,
            error: error.message
        };
    }
    return {
        success: true,
        error: null
    };
}

export function getAgentProcess(agentName) {
    return agent_processes[agentName];
}

export function startAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].forceRestart();
    }
    else {
        console.error(`Cannot start agent ${agentName}; not found`);
    }
}

export function stopAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].stop();
    }
}

export function destroyAgent(agentName) {
    if (agent_processes[agentName]) {
        agent_processes[agentName].stop();
        delete agent_processes[agentName];
    }
}

// ============ WORKER FUNCTIONS ============

/**
 * Create a worker bot (lightweight, no LLM).
 *
 * Workers are assigned to a leader and execute commands without API calls.
 */
export async function createWorker(workerName, leaderName, settings) {
    if (!workerName || !leaderName) {
        console.error('Worker name and leader name are required');
        return {
            success: false,
            error: 'Worker name and leader name are required'
        };
    }

    const workerSettings = JSON.parse(JSON.stringify(settings));

    // Load worker template for modes (self_defense, hunting, etc.)
    let workerTemplate = {};
    const templatePath = settings.hierarchy?.worker_template || './profiles/workers/worker_template.json';
    if (existsSync(templatePath)) {
        try {
            workerTemplate = JSON.parse(readFileSync(templatePath, 'utf8'));
            console.log(`[Mindcraft] Loaded worker template with modes:`, Object.keys(workerTemplate.modes || {}));
        } catch (err) {
            console.warn(`[Mindcraft] Failed to load worker template: ${err.message}`);
        }
    }

    workerSettings.profile = {
        name: workerName,
        is_worker: true,
        leader_name: leaderName,
        modes: workerTemplate.modes || {
            self_preservation: true,
            unstuck: true,
            cowardice: false,
            self_defense: true,
            hunting: true,
            item_collecting: true,
            torch_placing: true,
            elbow_room: false,
            idle_staring: false,
            cheat: false
        }
    };

    const workerIndex = worker_count++;
    registerWorker(workerName, leaderName, workerSettings);

    try {
        // Workers don't need server detection - use same settings as leader
        const workerProcess = new WorkerProcess(workerName, leaderName, mindserver_port);
        workerProcess.start(null, workerIndex);
        worker_processes[workerName] = workerProcess;

        console.log(`[Mindcraft] Worker ${workerName} created (leader: ${leaderName})`);

        return {
            success: true,
            error: null
        };
    } catch (error) {
        console.error(`Error creating worker ${workerName}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

export function getWorkerProcess(workerName) {
    return worker_processes[workerName];
}

export function stopWorker(workerName) {
    if (worker_processes[workerName]) {
        worker_processes[workerName].stop();
    }
}

export function destroyWorker(workerName) {
    if (worker_processes[workerName]) {
        worker_processes[workerName].stop();
        delete worker_processes[workerName];
    }
}

export function shutdown() {
    console.log('Shutting down');
    // Stop all agents
    for (let agentName in agent_processes) {
        agent_processes[agentName].stop();
    }
    // Stop all workers
    for (let workerName in worker_processes) {
        worker_processes[workerName].stop();
    }
    setTimeout(() => {
        process.exit(0);
    }, 2000);
}
