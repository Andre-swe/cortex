import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import { setSettings } from './settings.js';
import { getFullState } from './library/full_state.js';

// agent's individual connection to the mindserver
// always connect to localhost

class MindServerProxy {
    constructor() {
        if (MindServerProxy.instance) {
            return MindServerProxy.instance;
        }

        this.socket = null;
        this.connected = false;
        this.agents = [];
        this.workers = []; // Workers this leader has
        this.isWorker = false;
        this.leaderName = null;
        this.workerCommandCallback = null;
        MindServerProxy.instance = this;
    }

    async connect(name, port) {
        if (this.connected) return;
        
        this.name = name;
        this.socket = io(`http://localhost:${port}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => {
                console.error('Connection failed:', err);
                reject(err);
            });
        });

        this.connected = true;
        console.log(name, 'connected to MindServer');

        this.socket.on('disconnect', () => {
            console.log('Disconnected from MindServer');
            this.connected = false;
            if (this.agent) {
                this.agent.cleanKill('Disconnected from MindServer. Killing agent process.');
            }
        });

        this.socket.on('chat-message', (agentName, json) => {
            convoManager.receiveFromBot(agentName, json);
        });

        this.socket.on('agents-status', (agents) => {
            this.agents = agents;
            convoManager.updateAgents(agents);
            if (this.agent?.task) {
                console.log(this.agent.name, 'updating available agents');
                this.agent.task.updateAvailableAgents(agents);
            }
        });

        this.socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
		
        this.socket.on('send-message', (data) => {
            try {
                this.agent.respondFunc(data.from, data.message);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        });

        this.socket.on('get-full-state', (callback) => {
            try {
                const state = getFullState(this.agent);
                callback(state);
            } catch (error) {
                console.error('Error getting full state:', error);
                callback(null);
            }
        });

        // Handle worker joining (for leaders)
        this.socket.on('worker-joined', (workerName) => {
            console.log(`[Leader] Worker joined: ${workerName}`);
            // Add to proxy's worker list
            if (!this.workers.find(w => w.name === workerName)) {
                this.workers.push({ name: workerName, status: 'idle', position: null });
            }
            // Register with the agent
            if (this.agent && this.agent.registerWorker) {
                this.agent.registerWorker(workerName);
            }
        });

        // Handle worker leaving
        this.socket.on('worker-left', (workerName) => {
            console.log(`[Leader] Worker left: ${workerName}`);
            this.workers = this.workers.filter(w => w.name !== workerName);
            if (this.agent && this.agent.unregisterWorker) {
                this.agent.unregisterWorker(workerName);
            }
        });

        // Handle worker status updates
        this.socket.on('worker-status-update', (status) => {
            const worker = this.workers.find(w => w.name === status.worker);
            if (worker) {
                Object.assign(worker, status);
            }
        });

        // Request settings and wait for response
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Settings request timed out after 5 seconds'));
            }, 5000);

            this.socket.emit('get-settings', name, (response) => {
                clearTimeout(timeout);
                if (response.error) {
                    return reject(new Error(response.error));
                }
                setSettings(response.settings);
                this.socket.emit('connect-agent-process', name);
                resolve();
            });
        });
    }

    setAgent(agent) {
        this.agent = agent;
    }

    getAgents() {
        return this.agents;
    }

    getNumOtherAgents() {
        return this.agents.length - 1;
    }

    getOtherAgentNames() {
        return this.agents.map(agent => agent.name || agent);
    }

    login() {
        this.socket.emit('login-agent', this.agent.name);
    }

    shutdown() {
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }

    // ============ WORKER METHODS ============

    /**
     * Connect as a worker bot (lighter weight than full agent).
     */
    async connectWorker(name, port, leaderName) {
        if (this.connected) return;

        this.name = name;
        this.isWorker = true;
        this.leaderName = leaderName;
        this.socket = io(`http://localhost:${port}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => {
                console.error('[Worker] Connection failed:', err);
                reject(err);
            });
        });

        this.connected = true;
        console.log(`[Worker] ${name} connected to MindServer (leader: ${leaderName})`);

        this.socket.on('disconnect', () => {
            console.log('[Worker] Disconnected from MindServer');
            this.connected = false;
            if (this.worker) {
                this.worker.cleanKill('Disconnected from MindServer. Killing worker process.');
            }
        });

        // Listen for commands from leader
        this.socket.on('worker-command', (command, args, commandId) => {
            if (this.workerCommandCallback) {
                this.workerCommandCallback(command, args, commandId);
            }
        });

        // Request worker settings
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker settings request timed out'));
            }, 5000);

            this.socket.emit('get-worker-settings', name, leaderName, (response) => {
                clearTimeout(timeout);
                if (response.error) {
                    return reject(new Error(response.error));
                }
                setSettings(response.settings);
                this.socket.emit('register-worker', name, leaderName);
                resolve();
            });
        });
    }

    setWorker(worker) {
        this.worker = worker;
    }

    /**
     * Login as worker and register with leader.
     */
    loginWorker(leaderName) {
        this.socket.emit('login-worker', this.name, leaderName);
    }

    /**
     * Register callback for receiving commands from leader.
     */
    onWorkerCommand(callback) {
        this.workerCommandCallback = callback;
    }

    /**
     * Report worker status to leader.
     */
    reportWorkerStatus(status) {
        this.socket.emit('worker-status', status);
    }

    // ============ LEADER METHODS ============

    /**
     * Send command to a specific worker.
     */
    sendWorkerCommand(workerName, command, args) {
        const commandId = `${this.name}-${workerName}-${Date.now()}`;
        this.socket.emit('leader-command', {
            leader: this.name,
            worker: workerName,
            command,
            args,
            commandId,
            timestamp: Date.now()
        });
        return commandId;
    }

    /**
     * Send command to all workers assigned to this leader.
     */
    sendGroupCommand(command, args) {
        const commandId = `${this.name}-group-${Date.now()}`;
        this.socket.emit('leader-group-command', {
            leader: this.name,
            command,
            args,
            commandId,
            timestamp: Date.now()
        });
        return commandId;
    }

    /**
     * Register callback for worker status updates (leader only).
     */
    onWorkerStatus(callback) {
        this.socket.on('worker-status-update', callback);
    }

    /**
     * Get list of workers assigned to this leader.
     */
    getWorkers() {
        return this.workers;
    }

    /**
     * Update workers list (called by mindserver).
     */
    updateWorkers(workers) {
        this.workers = workers;
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    serverProxy.getSocket().emit('chat-message', agentName, json);
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    serverProxy.getSocket().emit('bot-output', agentName, message);
}

// for sending soul/cognitive events to server for display
export function sendSoulEvent(agentName, event) {
    const socket = serverProxy.getSocket();
    if (socket) {
        socket.emit('soul-event', agentName, event);
    }
}

// for sending relationship updates to server for display
export function sendRelationshipUpdate(agentName, targetName, relationship) {
    const socket = serverProxy.getSocket();
    if (socket) {
        socket.emit('relationship-update', {
            agent: agentName,
            target: targetName,
            trust: relationship.trust,
            respect: relationship.respect,
            familiarity: relationship.familiarity,
            affection: relationship.affection,
            type: relationship.type,
            interactionCount: relationship.interactionCount,
            timestamp: Date.now()
        });
    }
}
