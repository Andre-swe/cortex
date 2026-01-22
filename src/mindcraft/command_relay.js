/**
 * Command Relay System for Leader-Worker Hierarchy
 *
 * Routes commands from leaders to workers and status updates back.
 * Manages worker registration and command queuing.
 */

export class CommandRelay {
    constructor() {
        this.workers = new Map(); // workerName -> { leader, socket, status, lastUpdate }
        this.leaders = new Map(); // leaderName -> { socket, workers: Set }
        this.commandQueue = new Map(); // commandId -> { command, timestamp, status }
        this.workersByLeader = new Map(); // leaderName -> [workerNames]
    }

    /**
     * Register a worker with its assigned leader.
     */
    registerWorker(workerName, leaderName, socket) {
        this.workers.set(workerName, {
            leader: leaderName,
            socket,
            status: 'registered',
            lastUpdate: Date.now(),
            position: null,
            health: 20,
            food: 20
        });

        // Add to leader's worker list
        if (!this.workersByLeader.has(leaderName)) {
            this.workersByLeader.set(leaderName, []);
        }
        const leaderWorkers = this.workersByLeader.get(leaderName);
        if (!leaderWorkers.includes(workerName)) {
            leaderWorkers.push(workerName);
        }

        console.log(`[CommandRelay] Registered worker ${workerName} -> leader ${leaderName}`);
        console.log(`[CommandRelay] Leader ${leaderName} now has ${leaderWorkers.length} workers`);

        return true;
    }

    /**
     * Register a leader.
     */
    registerLeader(leaderName, socket) {
        this.leaders.set(leaderName, {
            socket,
            workers: new Set()
        });

        // Initialize workers list if not exists
        if (!this.workersByLeader.has(leaderName)) {
            this.workersByLeader.set(leaderName, []);
        }

        console.log(`[CommandRelay] Registered leader ${leaderName}`);
        return true;
    }

    /**
     * Remove a worker.
     */
    removeWorker(workerName) {
        const worker = this.workers.get(workerName);
        if (worker) {
            const leaderWorkers = this.workersByLeader.get(worker.leader);
            if (leaderWorkers) {
                const idx = leaderWorkers.indexOf(workerName);
                if (idx > -1) leaderWorkers.splice(idx, 1);
            }
            this.workers.delete(workerName);
            console.log(`[CommandRelay] Removed worker ${workerName}`);
        }
    }

    /**
     * Remove a leader.
     */
    removeLeader(leaderName) {
        this.leaders.delete(leaderName);
        console.log(`[CommandRelay] Removed leader ${leaderName}`);
    }

    /**
     * Route a command from leader to specific worker.
     */
    routeCommand(leaderName, workerName, command, args, commandId) {
        const worker = this.workers.get(workerName);
        if (!worker) {
            console.warn(`[CommandRelay] Worker ${workerName} not found`);
            return { success: false, error: 'Worker not found' };
        }

        if (worker.leader !== leaderName) {
            console.warn(`[CommandRelay] Worker ${workerName} not assigned to leader ${leaderName}`);
            return { success: false, error: 'Worker not assigned to this leader' };
        }

        // Store command for tracking
        this.commandQueue.set(commandId, {
            leader: leaderName,
            worker: workerName,
            command,
            args,
            timestamp: Date.now(),
            status: 'sent'
        });

        // Send to worker
        worker.socket.emit('worker-command', command, args, commandId);
        console.log(`[CommandRelay] Routed ${command} to worker ${workerName}`);

        return { success: true, commandId };
    }

    /**
     * Route command to all workers of a leader.
     */
    routeGroupCommand(leaderName, command, args, commandId) {
        const workers = this.workersByLeader.get(leaderName) || [];
        const results = [];

        workers.forEach((workerName, idx) => {
            const workerCommandId = `${commandId}-${idx}`;
            const result = this.routeCommand(leaderName, workerName, command, args, workerCommandId);
            results.push({ worker: workerName, ...result });
        });

        console.log(`[CommandRelay] Group command ${command} sent to ${workers.length} workers`);
        return results;
    }

    /**
     * Update worker status.
     */
    updateWorkerStatus(workerName, status) {
        const worker = this.workers.get(workerName);
        if (worker) {
            worker.status = status.status;
            worker.lastUpdate = Date.now();
            worker.position = status.position || worker.position;
            worker.health = status.health !== undefined ? status.health : worker.health;
            worker.food = status.food !== undefined ? status.food : worker.food;

            // Update command queue if this is a command completion
            if (status.commandId) {
                const cmd = this.commandQueue.get(status.commandId);
                if (cmd) {
                    cmd.status = status.status;
                    if (status.status === 'completed' || status.status === 'error') {
                        // Clean up completed commands after 60 seconds
                        setTimeout(() => {
                            this.commandQueue.delete(status.commandId);
                        }, 60000);
                    }
                }
            }

            // Forward status to leader
            const leader = this.leaders.get(worker.leader);
            if (leader && leader.socket) {
                leader.socket.emit('worker-status-update', {
                    worker: workerName,
                    ...status
                });
            }
        }
    }

    /**
     * Get all workers for a leader.
     */
    getWorkersForLeader(leaderName) {
        return this.workersByLeader.get(leaderName) || [];
    }

    /**
     * Get worker info.
     */
    getWorkerInfo(workerName) {
        return this.workers.get(workerName);
    }

    /**
     * Get all workers status (for Cortex UI).
     */
    getAllWorkersStatus() {
        const status = [];
        this.workers.forEach((info, name) => {
            status.push({
                name,
                leader: info.leader,
                status: info.status,
                position: info.position,
                health: info.health,
                food: info.food,
                lastUpdate: info.lastUpdate
            });
        });
        return status;
    }

    /**
     * Get hierarchy summary for UI.
     */
    getHierarchySummary() {
        const summary = {
            leaders: [],
            totalWorkers: this.workers.size
        };

        this.leaders.forEach((info, name) => {
            const workers = this.workersByLeader.get(name) || [];
            summary.leaders.push({
                name,
                workerCount: workers.length,
                workers: workers.map(w => {
                    const wInfo = this.workers.get(w);
                    return {
                        name: w,
                        status: wInfo?.status || 'unknown'
                    };
                })
            });
        });

        return summary;
    }

    /**
     * Get batched status updates for all workers (for efficient UI updates).
     */
    getBatchedWorkerStatus() {
        const batched = {};

        this.workersByLeader.forEach((workers, leader) => {
            batched[leader] = workers.map(w => {
                const info = this.workers.get(w);
                return {
                    name: w,
                    status: info?.status || 'unknown',
                    position: info?.position,
                    health: info?.health,
                    food: info?.food
                };
            });
        });

        return batched;
    }
}

// Export singleton instance
export const commandRelay = new CommandRelay();
