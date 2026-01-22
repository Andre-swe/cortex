import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { serverProxy } from '../mindserver_proxy.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },

    // ============ LEADER COMMANDS (Hierarchy Mode) ============

    {
        name: '!workerCollect',
        description: 'Order a worker to collect a specific block type. (LEADERS ONLY)',
        params: {
            'worker_name': { type: 'string', description: 'Name of worker (e.g., "Blaze", "Frost").' },
            'block_type': { type: 'string', description: 'Block to collect (e.g., "oak_log", "stone", "iron_ore").' },
            'num': { type: 'int', description: 'Number to collect (default 10).' }
        },
        perform: async function (agent, worker_name, block_type, num = 10) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (!agent.assignedWorkers.includes(worker_name)) {
                return `Worker "${worker_name}" not found. Your workers: ${agent.assignedWorkers.slice(0, 5).join(', ')}...`;
            }
            const commandId = serverProxy.sendWorkerCommand(worker_name, 'collectBlock', { type: block_type, num: num || 10 });
            return `${worker_name} is now collecting ${num || 10} ${block_type}.`;
        }
    },
    {
        name: '!workerGoTo',
        description: 'Order a worker to go to coordinates. (LEADERS ONLY)',
        params: {
            'worker_name': { type: 'string', description: 'Name of worker.' },
            'x': { type: 'int', description: 'X coordinate.' },
            'y': { type: 'int', description: 'Y coordinate.' },
            'z': { type: 'int', description: 'Z coordinate.' }
        },
        perform: async function (agent, worker_name, x, y, z) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (!agent.assignedWorkers.includes(worker_name)) {
                return `Worker "${worker_name}" not found. Your workers: ${agent.assignedWorkers.slice(0, 5).join(', ')}...`;
            }
            const commandId = serverProxy.sendWorkerCommand(worker_name, 'goToPosition', { x, y, z, closeness: 2 });
            return `${worker_name} is moving to (${x}, ${y}, ${z}).`;
        }
    },
    {
        name: '!workerFollow',
        description: 'Order a worker to follow a player or bot. (LEADERS ONLY)',
        params: {
            'worker_name': { type: 'string', description: 'Name of worker.' },
            'target': { type: 'string', description: 'Player/bot to follow.' }
        },
        perform: async function (agent, worker_name, target) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (!agent.assignedWorkers.includes(worker_name)) {
                return `Worker "${worker_name}" not found. Your workers: ${agent.assignedWorkers.slice(0, 5).join(', ')}...`;
            }
            const commandId = serverProxy.sendWorkerCommand(worker_name, 'followPlayer', { player_name: target, distance: 4 });
            return `${worker_name} is now following ${target}.`;
        }
    },
    {
        name: '!workerAttack',
        description: 'Order a worker to attack nearest hostile mob. (LEADERS ONLY)',
        params: {
            'worker_name': { type: 'string', description: 'Name of worker.' },
            'mob_type': { type: 'string', description: 'Mob to attack (e.g., "zombie", "skeleton", or "any").' }
        },
        perform: async function (agent, worker_name, mob_type = 'any') {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (!agent.assignedWorkers.includes(worker_name)) {
                return `Worker "${worker_name}" not found. Your workers: ${agent.assignedWorkers.slice(0, 5).join(', ')}...`;
            }
            const type = mob_type === 'any' ? 'hostile' : mob_type;
            const commandId = serverProxy.sendWorkerCommand(worker_name, 'attackNearest', { type, kill: true });
            return `${worker_name} is attacking ${mob_type} mobs.`;
        }
    },
    {
        name: '!allWorkersCollect',
        description: 'Order ALL your workers to collect a block type. (LEADERS ONLY)',
        params: {
            'block_type': { type: 'string', description: 'Block to collect (e.g., "oak_log", "cobblestone", "iron_ore").' },
            'num': { type: 'int', description: 'Amount each worker should collect (default 10).' }
        },
        perform: async function (agent, block_type, num = 10) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (agent.assignedWorkers.length === 0) return 'No workers assigned.';
            const commandId = serverProxy.sendGroupCommand('collectBlock', { type: block_type, num: num || 10 });
            return `All ${agent.assignedWorkers.length} workers are now collecting ${block_type}.`;
        }
    },
    {
        name: '!allWorkersFollow',
        description: 'Order ALL your workers to follow you. (LEADERS ONLY)',
        perform: async function (agent) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (agent.assignedWorkers.length === 0) return 'No workers assigned.';
            const commandId = serverProxy.sendGroupCommand('followPlayer', { player_name: agent.name, distance: 5 });
            return `All ${agent.assignedWorkers.length} workers are now following you.`;
        }
    },
    {
        name: '!allWorkersDefend',
        description: 'Order ALL your workers to attack nearby hostile mobs. (LEADERS ONLY)',
        perform: async function (agent) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (agent.assignedWorkers.length === 0) return 'No workers assigned.';
            const commandId = serverProxy.sendGroupCommand('attackNearest', { type: 'hostile', kill: true });
            return `All ${agent.assignedWorkers.length} workers are now defending against hostiles.`;
        }
    },
    {
        name: '!allWorkersStop',
        description: 'Order ALL your workers to stop what they are doing. (LEADERS ONLY)',
        perform: async function (agent) {
            if (!agent.isLeader) return 'This command is only for leaders.';
            if (agent.assignedWorkers.length === 0) return 'No workers assigned.';
            const commandId = serverProxy.sendGroupCommand('stop', {});
            return `All ${agent.assignedWorkers.length} workers stopped.`;
        }
    },
    {
        name: '!getWorkerStatus',
        description: 'Get the status of all your assigned workers. (LEADERS ONLY)',
        perform: async function (agent) {
            if (!agent.isLeader) {
                return 'This command is only available for leader bots.';
            }

            const workers = serverProxy.getWorkers();
            if (workers.length === 0) {
                return 'No workers assigned yet.';
            }

            let status = `Worker Status (${workers.length} total):\n`;
            workers.forEach(w => {
                const pos = w.position ? `(${w.position.x}, ${w.position.y}, ${w.position.z})` : 'unknown';
                status += `- ${w.name}: ${w.status} at ${pos}, HP: ${w.health}\n`;
            });

            return status;
        }
    },
    {
        name: '!recallWorkers',
        description: 'Bring all your workers to your current location. (LEADERS ONLY)',
        perform: async function (agent) {
            if (!agent.isLeader) {
                return 'This command is only available for leader bots.';
            }

            if (agent.assignedWorkers.length === 0) {
                return 'You have no workers assigned yet.';
            }

            const pos = agent.bot.entity.position;
            const args = {
                x: Math.floor(pos.x),
                y: Math.floor(pos.y),
                z: Math.floor(pos.z),
                closeness: 5
            };

            const commandId = serverProxy.sendGroupCommand('goToPosition', args);
            return `Recall command sent to ${agent.assignedWorkers.length} workers. They will gather at your position (${args.x}, ${args.y}, ${args.z}).`;
        }
    },
    {
        name: '!deployWorkers',
        description: 'Deploy workers in a pattern around a location for tasks like mining or gathering. (LEADERS ONLY)',
        params: {
            'task': { type: 'string', description: 'Task type: "mine", "gather", "defend", or "spread".' },
            'block_type': { type: 'string', description: 'Block type for mining/gathering tasks (optional).' }
        },
        perform: async function (agent, task, block_type) {
            if (!agent.isLeader) {
                return 'This command is only available for leader bots.';
            }

            if (agent.assignedWorkers.length === 0) {
                return 'You have no workers assigned yet.';
            }

            const pos = agent.bot.entity.position;
            const numWorkers = agent.assignedWorkers.length;
            let results = [];

            switch (task.toLowerCase()) {
                case 'mine':
                case 'gather':
                    // Send workers to collect blocks
                    if (!block_type) {
                        return 'Please specify a block_type for mining/gathering tasks.';
                    }
                    const commandId = serverProxy.sendGroupCommand('collectBlock', {
                        type: block_type,
                        num: 10
                    });
                    return `Deployed ${numWorkers} workers to gather ${block_type}. ID: ${commandId}`;

                case 'defend':
                    // Position workers in a defensive circle
                    const defenseRadius = 10;
                    agent.assignedWorkers.forEach((workerName, idx) => {
                        const angle = (idx / numWorkers) * Math.PI * 2;
                        const targetX = Math.floor(pos.x + Math.cos(angle) * defenseRadius);
                        const targetZ = Math.floor(pos.z + Math.sin(angle) * defenseRadius);
                        serverProxy.sendWorkerCommand(workerName, 'goToPosition', {
                            x: targetX,
                            y: Math.floor(pos.y),
                            z: targetZ,
                            closeness: 2
                        });
                    });
                    return `Deployed ${numWorkers} workers in defensive formation around you.`;

                case 'spread':
                    // Spread workers out to explore
                    const spreadRadius = 30;
                    agent.assignedWorkers.forEach((workerName, idx) => {
                        const angle = (idx / numWorkers) * Math.PI * 2;
                        const targetX = Math.floor(pos.x + Math.cos(angle) * spreadRadius);
                        const targetZ = Math.floor(pos.z + Math.sin(angle) * spreadRadius);
                        serverProxy.sendWorkerCommand(workerName, 'goToPosition', {
                            x: targetX,
                            y: Math.floor(pos.y),
                            z: targetZ,
                            closeness: 2
                        });
                    });
                    return `Deployed ${numWorkers} workers to spread out and explore.`;

                default:
                    return `Unknown task: ${task}. Available tasks: mine, gather, defend, spread.`;
            }
        }
    },
];
