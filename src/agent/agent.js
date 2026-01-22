import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import conversationCoordinator from './conversation_coordinator.js';
import soulStateManager from './soul/soul_state.js';

// Lazy load cognitive engine to avoid early API key access
let _cognitiveEngine = null;
async function getCognitiveEngine() {
    if (!_cognitiveEngine) {
        const module = await import('./soul/cognitive_engine.js');
        _cognitiveEngine = module.default;
    }
    return _cognitiveEngine;
}

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Hierarchy mode: tick-based thinking for leaders
        this.isLeader = settings.hierarchy_mode && settings.profile.is_leader;
        this.pendingContext = []; // Queue of events to process on next tick
        this.thoughtTickInterval = null;
        this.assignedWorkers = []; // Worker names assigned to this leader
        this.leaderName = settings.profile.leader_name || null; // For workers: their leader's name

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // Register personality with conversation coordinator for natural multi-agent chat
        const personality = this.prompter.profile.personality || {};
        conversationCoordinator.registerBot(this.name, {
            chattiness: personality.chattiness || 0.5,
            responseDelay: personality.responseDelay || { min: 1500, max: 4000 },
            interests: personality.interests || [],
            conversationStyle: personality.conversationStyle || 'balanced'
        });

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type } = handleDisconnection(this.name, reason);
     
            process.exit(1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

                // Start proactive chat timer
                this._startProactiveChat();

                // Start tick-based thinking for leaders in hierarchy mode
                if (this.isLeader) {
                    this._startThoughtTick();
                }

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    // Allow natural bot-to-bot conversations
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', async (username, message) => {
            // Record incoming message for soul state tracking
            const isFromBot = serverProxy.getOtherAgentNames().includes(username);
            conversationCoordinator.recordIncomingMessage(username, message, isFromBot);

            // Natural conversation handling with multiple agents
            if (serverProxy.getNumOtherAgents() > 0) {
                const otherAgents = serverProxy.getOtherAgentNames();

                // Use cognitive engine for intelligent response decisions (async)
                const decision = await conversationCoordinator.shouldRespond(
                    this.name,
                    username,
                    message,
                    otherAgents
                );

                console.log(`[${this.name}] Soul decision: ${decision.reason} (respond: ${decision.shouldRespond})`);

                if (!decision.shouldRespond) {
                    // Silently skip - natural conversation behavior
                    return;
                }

                // Add natural delay before responding
                if (decision.delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, decision.delay));

                    // Re-check if someone else responded while we were waiting
                    const timeSinceLastResponse = Date.now() - conversationCoordinator.lastResponse.timestamp;
                    if (timeSinceLastResponse < 2000 &&
                        conversationCoordinator.lastResponse.responder !== this.name &&
                        decision.reason !== 'directly_mentioned') {
                        // Someone else jumped in, skip unless we were directly mentioned
                        return;
                    }
                }

                // Record that we're responding
                conversationCoordinator.recordResponse(this.name, username, message);
            }
            respondFunc(username, message);
        });

        // Handle player_chat packets directly for Paper 1.21+ compatibility
        this.bot._client.on('player_chat', (packet) => {
            if (packet.plainMessage) {
                // Get username from UUID
                const senderUuid = packet.senderUuid;
                let username = null;
                for (const [name, player] of Object.entries(this.bot.players)) {
                    if (player.uuid === senderUuid) {
                        username = name;
                        break;
                    }
                }
                if (username && username !== this.name) {
                    console.log(`[${this.name}] Received chat from ${username}: ${packet.plainMessage}`);
                    // Trigger the chat handler
                    this.bot.emit('chat', username, packet.plainMessage);
                }
            }
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                let execute_res = await executeCommand(this, message);
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    /**
     * Start proactive chat timer - bots occasionally share thoughts
     */
    _startProactiveChat() {
        const personality = this.prompter.profile.personality || {};
        const chattiness = personality.chattiness || 0.5;

        // Base interval: 2-4 minutes, adjusted by personality
        // Extroverts chat more often, introverts less
        const baseInterval = 120000; // 2 minutes
        const variance = 120000; // +0-2 minutes
        const personalityMultiplier = chattiness < 0.3 ? 2 : chattiness > 0.6 ? 0.7 : 1;

        const scheduleNext = () => {
            const interval = (baseInterval + Math.random() * variance) * personalityMultiplier;

            this.proactiveChatTimer = setTimeout(async () => {
                try {
                    // Don't interrupt if busy or recently spoke
                    if (this.actions.executing || Date.now() - (this._lastProactiveChat || 0) < 60000) {
                        scheduleNext();
                        return;
                    }

                    // Get context about what's happening
                    const pos = this.bot.entity?.position;
                    const nearbyContext = pos ? `at ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}` : '';
                    const activity = this.actions.currentActionLabel || 'idle';
                    const recentChat = conversationCoordinator.getConversationContext(this.name).recentContext || '';
                    const otherBots = serverProxy.getOtherAgentNames().filter(n => n !== this.name);

                    const engine = await getCognitiveEngine();
                    const result = await engine.proactiveThought(
                        this.name,
                        personality,
                        activity,
                        nearbyContext,
                        recentChat,
                        otherBots
                    );

                    if (result.shouldSpeak && result.thought) {
                        console.log(`[${this.name}] Proactive thought: ${result.thought}`);
                        this.bot.chat(result.thought);
                        this._lastProactiveChat = Date.now();
                    }
                } catch (err) {
                    console.error('Proactive chat error:', err.message);
                }

                scheduleNext();
            }, interval);
        };

        // Start after a random initial delay (30-60s)
        setTimeout(scheduleNext, 30000 + Math.random() * 30000);
        console.log(`[${this.name}] Proactive chat enabled (chattiness: ${chattiness})`);
    }

    /**
     * Start tick-based thinking for leaders in hierarchy mode.
     * Instead of responding to every message immediately, leaders accumulate
     * context for a tick interval and make ONE batched LLM call.
     * This dramatically reduces API costs (~95% reduction for 100 agents).
     */
    _startThoughtTick() {
        if (!this.isLeader) return;

        const tickInterval = settings.thought_tick_interval || 30000;
        console.log(`[${this.name}] Starting thought tick (${tickInterval}ms interval) - Leader mode enabled`);

        this.thoughtTickInterval = setInterval(async () => {
            if (this.pendingContext.length === 0) return;

            try {
                await this._processThoughtTick();
            } catch (err) {
                console.error(`[${this.name}] Thought tick error:`, err.message);
            }
        }, tickInterval);
    }

    /**
     * Process accumulated context in a single batched LLM call.
     * This is called on each thought tick for leaders.
     */
    async _processThoughtTick() {
        if (this.pendingContext.length === 0) return;

        const contextBatch = [...this.pendingContext];
        this.pendingContext = [];

        console.log(`[${this.name}] Processing thought tick with ${contextBatch.length} pending events`);

        // Build a consolidated context summary
        const workerReports = contextBatch.filter(c => c.type === 'worker_report');
        const chatMessages = contextBatch.filter(c => c.type === 'chat');
        const events = contextBatch.filter(c => c.type === 'event');

        // Create a batched summary message
        let batchedMessage = '';

        if (workerReports.length > 0) {
            batchedMessage += `\n[WORKER REPORTS - ${workerReports.length} updates]\n`;
            workerReports.forEach(r => {
                batchedMessage += `- ${r.worker}: ${r.status} ${r.details || ''}\n`;
            });
        }

        if (chatMessages.length > 0) {
            batchedMessage += `\n[CHAT MESSAGES - ${chatMessages.length} messages]\n`;
            chatMessages.forEach(m => {
                batchedMessage += `- ${m.source}: "${m.message}"\n`;
            });
        }

        if (events.length > 0) {
            batchedMessage += `\n[EVENTS - ${events.length} events]\n`;
            events.forEach(e => {
                batchedMessage += `- ${e.event}: ${e.details || ''}\n`;
            });
        }

        if (this.assignedWorkers.length > 0) {
            batchedMessage += `\n[YOUR WORKERS: ${this.assignedWorkers.join(', ')}]\n`;
            batchedMessage += `Use !commandWorker(worker_name, command, args) or !commandGroup(command, args) to direct workers.\n`;
        }

        if (batchedMessage.trim()) {
            // Process the batched context as a single system message
            await this.history.add('system', `[THOUGHT TICK BATCH]${batchedMessage}`);

            // Get LLM response for the batched context
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            if (res && res.trim().length > 0) {
                console.log(`[${this.name}] Thought tick response: ${res}`);
                this.history.add(this.name, res);

                // Check for commands in response
                const command_name = containsCommand(res);
                if (command_name && commandExists(command_name)) {
                    const execute_res = await executeCommand(this, res);
                    if (execute_res) {
                        this.history.add('system', execute_res);
                    }
                }

                // Send chat response
                this.openChat(res);
            }
        }

        this.history.save();
    }

    /**
     * Queue context for the next thought tick (leaders only).
     * Workers and non-hierarchy agents process messages immediately.
     */
    queueContext(contextItem) {
        if (!this.isLeader) return false;

        this.pendingContext.push({
            ...contextItem,
            timestamp: Date.now()
        });

        return true;
    }

    /**
     * Register a worker with this leader.
     */
    registerWorker(workerName) {
        if (!this.isLeader) return;
        if (!this.assignedWorkers.includes(workerName)) {
            this.assignedWorkers.push(workerName);
            console.log(`[${this.name}] Registered worker: ${workerName} (total: ${this.assignedWorkers.length})`);
        }
    }

    /**
     * Get list of assigned workers.
     */
    getWorkers() {
        return [...this.assignedWorkers];
    }

    /**
     * Unregister a worker from this leader.
     */
    unregisterWorker(workerName) {
        if (!this.isLeader) return;
        const idx = this.assignedWorkers.indexOf(workerName);
        if (idx !== -1) {
            this.assignedWorkers.splice(idx, 1);
            console.log(`[${this.name}] Unregistered worker: ${workerName} (remaining: ${this.assignedWorkers.length})`);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });

        // React to being hurt/attacked
        this.bot.on('entityHurt', (entity) => {
            if (entity === this.bot.entity) {
                // Find who attacked us
                const attacker = this.bot.nearestEntity(e =>
                    e.type === 'player' && e.username !== this.name &&
                    e.position.distanceTo(this.bot.entity.position) < 5
                );

                if (attacker && attacker.username) {
                    const attackerName = attacker.username;
                    console.log(`[${this.name}] Was hurt by ${attackerName}!`);

                    // Update emotional state - get angry!
                    const state = soulStateManager.getState(this.name);
                    state.setEmotion('angry', 0.9);
                    state.addGrievance(attackerName, 'attacked me');

                    // Record as negative relationship interaction
                    conversationCoordinator.recordSignificantInteraction(
                        this.name,
                        attackerName,
                        'attacked',
                        { summary: 'physically attacked me' }
                    );

                    // React verbally if not already busy
                    if (this.isIdle()) {
                        const reactions = [
                            `Hey! What was that for, ${attackerName}?!`,
                            `Ow! ${attackerName}, why'd you hit me?`,
                            `${attackerName}! Watch it!`,
                            `Seriously ${attackerName}?!`,
                            `Not cool, ${attackerName}.`
                        ];
                        const reaction = reactions[Math.floor(Math.random() * reactions.length)];
                        this.bot.chat(reaction);
                    }
                }
            }
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.x.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;
                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}