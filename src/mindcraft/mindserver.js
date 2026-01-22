import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import express from 'express';
import http from 'http';
import { fileURLToPath } from 'url';
import * as mindcraft from './mindcraft.js';
import { readFileSync } from 'fs';
import { commandRelay } from './command_relay.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mindserver is:
// - central hub for communication between all agent processes
// - api to control from other languages and remote users
// - host for webapp
// - command relay for leader-worker hierarchy

let io;
let server;
const agent_connections = {};
const worker_connections = {};
const relationship_cache = new Map();  // Cache relationships for new clients // workerName -> { socket, leader, settings }

// Load saved relationships from bot files
function loadSavedRelationships() {
    const botsDir = './bots';
    try {
        if (!fs.existsSync(botsDir)) return;

        const botFolders = fs.readdirSync(botsDir);
        for (const botName of botFolders) {
            const relPath = path.join(botsDir, botName, 'relationships.json');
            if (fs.existsSync(relPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(relPath, 'utf8'));
                    if (data.relationships) {
                        for (const [target, rel] of Object.entries(data.relationships)) {
                            const key = [botName, target].sort().join('-');
                            relationship_cache.set(key, {
                                agent: botName,
                                target: target,
                                trust: rel.trust || 0,
                                respect: rel.respect || 0,
                                familiarity: rel.fondness || 0,
                                affection: rel.fondness || 0,
                                type: rel.type || 'stranger',
                                interactionCount: rel.totalInteractions || 0,
                                timestamp: rel.lastInteraction || Date.now()
                            });
                        }
                    }
                } catch (e) {
                    console.log(`[MindServer] Could not load relationships for ${botName}: ${e.message}`);
                }
            }
        }
        console.log(`[MindServer] Loaded ${relationship_cache.size} relationships from saved files`);
    } catch (e) {
        console.log(`[MindServer] Error loading saved relationships: ${e.message}`);
    }
}

// Load relationships on startup
loadSavedRelationships();

const agent_listeners = [];

const settings_spec = JSON.parse(readFileSync(path.join(__dirname, 'public/settings_spec.json'), 'utf8'));

class AgentConnection {
    constructor(settings, viewer_port) {
        this.socket = null;
        this.settings = settings;
        this.in_game = false;
        this.full_state = null;
        this.viewer_port = viewer_port;
    }
    setSettings(settings) {
        this.settings = settings;
    }
}

export function registerAgent(settings, viewer_port) {
    let agentConnection = new AgentConnection(settings, viewer_port);
    agent_connections[settings.profile.name] = agentConnection;
}

export function logoutAgent(agentName) {
    if (agent_connections[agentName]) {
        agent_connections[agentName].in_game = false;
        agentsStatusUpdate();
    }
}

// Worker registration
export function registerWorker(workerName, leaderName, settings) {
    worker_connections[workerName] = {
        socket: null,
        leader: leaderName,
        settings,
        in_game: false,
        status: 'registered'
    };
    console.log(`[MindServer] Registered worker ${workerName} -> leader ${leaderName}`);
}

export function logoutWorker(workerName) {
    if (worker_connections[workerName]) {
        const leaderName = worker_connections[workerName].leader;
        worker_connections[workerName].in_game = false;
        commandRelay.removeWorker(workerName);
        workersStatusUpdate();

        // Notify leader that worker left
        const leader = agent_connections[leaderName];
        if (leader && leader.socket) {
            leader.socket.emit('worker-left', workerName);
        }
    }
}

// Initialize the server
export function createMindServer(host_public = false, port = 8080) {
    const app = express();
    server = http.createServer(app);
    io = new Server(server);

    // Serve static files
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    app.use(express.static(path.join(__dirname, 'public')));

    // Serve stream overlays for OBS
    app.use('/stream', express.static(path.join(__dirname, '../../stream')));

    // Socket.io connection handling
    io.on('connection', (socket) => {
        let curAgentName = null;
        console.log('Client connected');

        agentsStatusUpdate(socket);
        workersStatusUpdate(socket);

        socket.on('create-agent', async (settings, callback) => {
            console.log('API create agent...');
            for (let key in settings_spec) {
                if (!(key in settings)) {
                    if (settings_spec[key].required) {
                        callback({ success: false, error: `Setting ${key} is required` });
                        return;
                    }
                    else {
                        settings[key] = settings_spec[key].default;
                    }
                }
            }
            for (let key in settings) {
                if (!(key in settings_spec)) {
                    delete settings[key];
                }
            }
            if (settings.profile?.name) {
                if (settings.profile.name in agent_connections) {
                    callback({ success: false, error: 'Agent already exists' });
                    return;
                }
                let returned = await mindcraft.createAgent(settings);
                callback({ success: returned.success, error: returned.error });
                let name = settings.profile.name;
                if (!returned.success && agent_connections[name]) {
                    mindcraft.destroyAgent(name);
                    delete agent_connections[name];
                }
                agentsStatusUpdate();
            }
            else {
                console.error('Agent name is required in profile');
                callback({ success: false, error: 'Agent name is required in profile' });
            }
        });

        socket.on('get-settings', (agentName, callback) => {
            if (agent_connections[agentName]) {
                callback({ settings: agent_connections[agentName].settings });
            } else {
                callback({ error: `Agent '${agentName}' not found.` });
            }
        });

        socket.on('connect-agent-process', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agentsStatusUpdate();
            }
        });

        socket.on('login-agent', (agentName) => {
            if (agent_connections[agentName]) {
                agent_connections[agentName].socket = socket;
                agent_connections[agentName].in_game = true;
                curAgentName = agentName;
                agentsStatusUpdate();
            }
            else {
                console.warn(`Unregistered agent ${agentName} tried to login`);
            }
        });

        socket.on('disconnect', () => {
            if (agent_connections[curAgentName]) {
                console.log(`Agent ${curAgentName} disconnected`);
                agent_connections[curAgentName].in_game = false;
                agent_connections[curAgentName].socket = null;
                agentsStatusUpdate();
            }
            if (agent_listeners.includes(socket)) {
                removeListener(socket);
            }
        });

        socket.on('chat-message', (agentName, json) => {
            const targetAgent = agent_connections[agentName];
            if (!targetAgent || !targetAgent.socket) {
                console.warn(`Agent ${agentName} not available for message from ${curAgentName}`);
                return;
            }
            console.log(`${curAgentName} sending message to ${agentName}: ${json.message}`);
            targetAgent.socket.emit('chat-message', curAgentName, json);
        });

        socket.on('set-agent-settings', (agentName, settings) => {
            const agent = agent_connections[agentName];
            if (agent && agent.socket) {
                agent.setSettings(settings);
                agent.socket.emit('restart-agent');
            }
        });

        socket.on('restart-agent', (agentName) => {
            const agent = agent_connections[agentName];
            if (agent && agent.socket) {
                console.log(`Restarting agent: ${agentName}`);
                agent.socket.emit('restart-agent');
            }
        });

        socket.on('stop-agent', (agentName) => {
            mindcraft.stopAgent(agentName);
        });

        socket.on('start-agent', (agentName) => {
            mindcraft.startAgent(agentName);
        });

        socket.on('destroy-agent', (agentName) => {
            if (agent_connections[agentName]) {
                mindcraft.destroyAgent(agentName);
                delete agent_connections[agentName];
            }
            agentsStatusUpdate();
        });

        socket.on('stop-all-agents', () => {
            console.log('Killing all agents');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
        });

        socket.on('shutdown', () => {
            console.log('Shutting down');
            for (let agentName in agent_connections) {
                mindcraft.stopAgent(agentName);
            }
            // wait 2 seconds
            setTimeout(() => {
                console.log('Exiting MindServer');
                process.exit(0);
            }, 2000);
            
        });

		socket.on('send-message', (agentName, data) => {
			if (!agent_connections[agentName]) {
				console.warn(`Agent ${agentName} not in game, cannot send message via MindServer.`);
				return
			}
			try {
				agent_connections[agentName].socket.emit('send-message', data)
			} catch (error) {
				console.error('Error: ', error);
			}
		});

        socket.on('bot-output', (agentName, message) => {
            io.emit('bot-output', agentName, message);
        });

        // Relay soul/cognitive events to all connected clients
        socket.on('soul-event', (agentName, event) => {
            io.emit('soul-event', agentName, event);
        });

        socket.on('relationship-update', (data) => {
            // Cache the relationship for new client connections
            const key = [data.agent, data.target].sort().join('-');
            relationship_cache.set(key, {
                ...data,
                timestamp: Date.now()
            });

            io.emit('relationship-update', data);
        });

        socket.on('listen-to-agents', () => {
            addListener(socket);

            // Send cached relationships to new client
            relationship_cache.forEach((rel, key) => {
                socket.emit('relationship-update', rel);
            });
        });

        // ============ WORKER EVENTS ============

        // Worker requests settings before starting
        socket.on('get-worker-settings', (workerName, leaderName, callback) => {
            if (worker_connections[workerName]) {
                callback({ settings: worker_connections[workerName].settings });
            } else {
                // Return minimal settings for worker
                const leaderSettings = agent_connections[leaderName]?.settings;
                if (leaderSettings) {
                    callback({
                        settings: {
                            ...leaderSettings,
                            profile: {
                                name: workerName,
                                is_worker: true,
                                leader_name: leaderName
                            }
                        }
                    });
                } else {
                    callback({ error: `Leader '${leaderName}' not found.` });
                }
            }
        });

        // Worker registers with its leader
        socket.on('register-worker', (workerName, leaderName) => {
            if (!worker_connections[workerName]) {
                worker_connections[workerName] = {
                    socket: null,
                    leader: leaderName,
                    settings: null,
                    in_game: false,
                    status: 'registered'
                };
            }
            worker_connections[workerName].socket = socket;
            commandRelay.registerWorker(workerName, leaderName, socket);
            workersStatusUpdate();
        });

        // Worker logs in (spawned in game)
        socket.on('login-worker', (workerName, leaderName) => {
            if (worker_connections[workerName]) {
                worker_connections[workerName].socket = socket;
                worker_connections[workerName].in_game = true;
                workersStatusUpdate();

                // Notify leader of new worker
                const leader = agent_connections[leaderName];
                if (leader && leader.socket) {
                    leader.socket.emit('worker-joined', workerName);
                }
            }
        });

        // Worker sends status update
        socket.on('worker-status', (status) => {
            commandRelay.updateWorkerStatus(status.worker, status);
            // Forward to leader and listeners
            io.emit('worker-status-update', status);
        });

        // ============ LEADER EVENTS ============

        // Leader sends command to specific worker
        socket.on('leader-command', (data) => {
            const result = commandRelay.routeCommand(
                data.leader,
                data.worker,
                data.command,
                data.args,
                data.commandId
            );
            // Emit command to listeners for UI tracking
            io.emit('command-sent', {
                leader: data.leader,
                worker: data.worker,
                command: data.command,
                commandId: data.commandId,
                timestamp: data.timestamp
            });
        });

        // Leader sends command to all assigned workers
        socket.on('leader-group-command', (data) => {
            const results = commandRelay.routeGroupCommand(
                data.leader,
                data.command,
                data.args,
                data.commandId
            );
            // Emit group command to listeners
            io.emit('group-command-sent', {
                leader: data.leader,
                command: data.command,
                commandId: data.commandId,
                workerCount: results.length,
                timestamp: data.timestamp
            });
        });

        // Get hierarchy status
        socket.on('get-hierarchy-status', (callback) => {
            callback(commandRelay.getHierarchySummary());
        });

        // Get all workers status (batched for efficiency)
        socket.on('get-workers-batch-status', (callback) => {
            callback(commandRelay.getBatchedWorkerStatus());
        });
    });

    let host = host_public ? '0.0.0.0' : 'localhost';
    server.listen(port, host, () => {
        console.log(`MindServer running on port ${port}`);
    });

    return server;
}

function agentsStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let agents = [];
    for (let agentName in agent_connections) {
        const conn = agent_connections[agentName];
        agents.push({
            name: agentName,
            in_game: conn.in_game,
            viewerPort: conn.viewer_port,
            socket_connected: !!conn.socket,
            is_leader: conn.settings?.profile?.is_leader || false
        });
    };
    socket.emit('agents-status', agents);
}

function workersStatusUpdate(socket) {
    if (!socket) {
        socket = io;
    }
    let workers = [];
    for (let workerName in worker_connections) {
        const conn = worker_connections[workerName];
        workers.push({
            name: workerName,
            leader: conn.leader,
            in_game: conn.in_game,
            status: conn.status,
            socket_connected: !!conn.socket
        });
    };
    socket.emit('workers-status', workers);
    // Also emit hierarchy summary
    socket.emit('hierarchy-status', commandRelay.getHierarchySummary());
}


let listenerInterval = null;
function addListener(listener_socket) {
    agent_listeners.push(listener_socket);
    if (agent_listeners.length === 1) {
        listenerInterval = setInterval(async () => {
            const states = {};
            for (let agentName in agent_connections) {
                let agent = agent_connections[agentName];
                if (agent.in_game) {
                    try {
                        const state = await new Promise((resolve) => {
                            agent.socket.emit('get-full-state', (s) => resolve(s));
                        });
                        states[agentName] = state;
                    } catch (e) {
                        states[agentName] = { error: String(e) };
                    }
                }
            }
            for (let listener of agent_listeners) {
                listener.emit('state-update', states);
            }
        }, 1000);
    }
}

function removeListener(listener_socket) {
    agent_listeners.splice(agent_listeners.indexOf(listener_socket), 1);
    if (agent_listeners.length === 0) {
        clearInterval(listenerInterval);
        listenerInterval = null;
    }
}

// Optional: export these if you need access to them from other files
export const getIO = () => io;
export const getServer = () => server;
export const numStateListeners = () => agent_listeners.length;