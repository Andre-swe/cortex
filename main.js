import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync, existsSync } from 'fs';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .option('hierarchy', {
            type: 'boolean',
            describe: 'Enable hierarchy mode with leaders and workers',
            default: false
        })
        .option('leaders', {
            type: 'number',
            describe: 'Number of leader bots (hierarchy mode)',
            default: 3
        })
        .option('workers', {
            type: 'number',
            describe: 'Total number of worker bots (hierarchy mode)',
            default: 97
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    }
    else {
        throw new Error('task_id is required when task_path is provided');
    }
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) {
    settings.port = process.env.MINECRAFT_PORT;
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = process.env.MINDSERVER_PORT;
}
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) {
    settings.profiles = JSON.parse(process.env.PROFILES);
}
if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = true;
}
if (process.env.BLOCKED_ACTIONS) {
    settings.blocked_actions = JSON.parse(process.env.BLOCKED_ACTIONS);
}
if (process.env.MAX_MESSAGES) {
    settings.max_messages = process.env.MAX_MESSAGES;
}
if (process.env.NUM_EXAMPLES) {
    settings.num_examples = process.env.NUM_EXAMPLES;
}
if (process.env.LOG_ALL) {
    settings.log_all_prompts = process.env.LOG_ALL;
}

// Check for hierarchy mode from args
if (args.hierarchy) {
    settings.hierarchy_mode = true;
}

Mindcraft.init(true, settings.mindserver_port, settings.auto_open_ui);

// Shuffled worker name pools - ALL UNIQUE names across all pools
const WORKER_NAMES = {
    Alpha: ['Blaze', 'Frost', 'Hawk', 'Stone', 'Cedar', 'Rook', 'Fang', 'Slate', 'Ember', 'Crag',
            'Ash', 'Vex', 'Dusk', 'Thorn', 'Grit', 'Pyre', 'Zane', 'Cliff', 'Rex', 'Nox',
            'Bane', 'Koda', 'Flint', 'Dax', 'Haze', 'Jett', 'Knox', 'Onyx', 'Pike', 'Slade',
            'Talon', 'Vigil', 'Wolf', 'Axe', 'Bear', 'Cole', 'Duke', 'Gage', 'Hunt', 'Jax'],
    Beta: ['Storm', 'Raven', 'Shade', 'Viper', 'Crow', 'Spike', 'Rift', 'Husk', 'Wren', 'Mace',
           'Bolt', 'Colt', 'Dash', 'Edge', 'Finn', 'Grim', 'Holt', 'Jinx', 'Kite', 'Lux',
           'Mars', 'Nash', 'Odin', 'Clay', 'Quill', 'Rune', 'Scar', 'Tank', 'Vale', 'Wisp',
           'Ymir', 'Zed', 'Ace', 'Bram', 'Cyrus', 'Drex', 'Echo', 'Flux', 'Gale', 'Hex'],
    Gamma: ['Drake', 'Phoenix', 'Tusk', 'Lynx', 'Griff', 'Mako', 'Kuro', 'Zuko', 'Ryze', 'Brock',
            'Cato', 'Dirk', 'Ezra', 'Cruz', 'Reed', 'Hugo', 'Ivan', 'Jace', 'Kai', 'Levi',
            'Max', 'Nero', 'Otto', 'Wes', 'Quinn', 'Remy', 'Seth', 'Troy', 'Uri', 'Vance',
            'Wade']
};

// Shuffle array using Fisher-Yates
function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Shuffle name pools on startup
const shuffledNames = {
    Alpha: shuffleArray(WORKER_NAMES.Alpha),
    Beta: shuffleArray(WORKER_NAMES.Beta),
    Gamma: shuffleArray(WORKER_NAMES.Gamma)
};

// Get worker name - use shuffled pool names first, then fallback to numbered
function getWorkerName(leaderName, index) {
    const pool = shuffledNames[leaderName] || [];
    if (index < pool.length) {
        return pool[index]; // Just the name, e.g., "Blaze", "Storm"
    }
    return `${leaderName}Minion${index + 1}`; // Fallback: "AlphaMinion41"
}

// Stagger agent spawns to avoid server throttling
const LEADER_SPAWN_DELAY_MS = 30000; // 30 seconds between leaders
const WORKER_SPAWN_DELAY_MS = settings.worker_spawn_delay || 3000; // 3 seconds between batches
const WORKER_BATCH_SIZE = settings.worker_spawn_batch_size || 5; // Workers spawned in parallel
const WORKER_INDIVIDUAL_DELAY_MS = 500; // 500ms between individual workers in a batch

/**
 * Standard mode: Spawn agents with staggered delays.
 */
async function spawnAgentsStaggered() {
    for (let i = 0; i < settings.profiles.length; i++) {
        const profile = settings.profiles[i];
        const profile_json = JSON.parse(readFileSync(profile, 'utf8'));
        settings.profile = profile_json;
        console.log(`Spawning agent ${profile_json.name}...`);
        Mindcraft.createAgent(settings);

        // Wait before spawning next agent (except for last one)
        if (i < settings.profiles.length - 1) {
            console.log(`Waiting ${LEADER_SPAWN_DELAY_MS/1000}s before next agent...`);
            await new Promise(resolve => setTimeout(resolve, LEADER_SPAWN_DELAY_MS));
        }
    }
}

/**
 * Hierarchy mode: Spawn leaders first, then workers in batches.
 *
 * Architecture:
 * - 3-5 Leaders: Full LLM capabilities, 30-second thought tick
 * - 95-97 Workers: No LLM, execute commands from leaders
 *
 * Cost optimization:
 * - Leaders make ~120 LLM calls/hour each (30s tick)
 * - Workers make 0 LLM calls
 * - Total: ~360-600 calls/hour vs ~6000 with 100 individual agents
 */
async function spawnHierarchy() {
    const numLeaders = args.leaders || 3;
    const numWorkers = args.workers || 97;
    const workersPerLeader = Math.ceil(numWorkers / numLeaders);

    console.log(`\n========================================`);
    console.log(`HIERARCHY MODE: ${numLeaders} Leaders, ${numWorkers} Workers`);
    console.log(`Workers per leader: ~${workersPerLeader}`);
    console.log(`========================================\n`);

    // Generate leader profiles from existing profiles or use hierarchy config
    let leaderProfiles = [];
    if (settings.hierarchy.leaders && settings.hierarchy.leaders.length > 0) {
        leaderProfiles = settings.hierarchy.leaders;
    } else if (settings.profiles && settings.profiles.length > 0) {
        // Use existing profiles as leaders
        leaderProfiles = settings.profiles.slice(0, numLeaders).map((p, i) => ({
            profile: p,
            workers: i < numLeaders - 1 ? workersPerLeader : numWorkers - (workersPerLeader * (numLeaders - 1))
        }));
    } else {
        console.error('No leader profiles configured!');
        console.error('Set settings.hierarchy.leaders or settings.profiles');
        process.exit(1);
    }

    // Phase 1: Spawn leaders with full delay
    console.log(`\n[Phase 1] Spawning ${leaderProfiles.length} leaders...`);
    const leaders = [];

    for (let i = 0; i < leaderProfiles.length; i++) {
        const leaderConfig = leaderProfiles[i];
        const profilePath = leaderConfig.profile;

        if (!existsSync(profilePath)) {
            console.error(`Leader profile not found: ${profilePath}`);
            continue;
        }

        const profile_json = JSON.parse(readFileSync(profilePath, 'utf8'));
        profile_json.is_leader = true;
        profile_json.thought_tick_interval = settings.thought_tick_interval || 30000;

        settings.profile = profile_json;
        console.log(`[Leader ${i + 1}/${leaderProfiles.length}] Spawning ${profile_json.name}...`);

        await Mindcraft.createAgent(settings);
        leaders.push({
            name: profile_json.name,
            workerCount: leaderConfig.workers || workersPerLeader
        });

        // Wait between leaders
        if (i < leaderProfiles.length - 1) {
            console.log(`Waiting ${LEADER_SPAWN_DELAY_MS / 1000}s before next leader...`);
            await new Promise(resolve => setTimeout(resolve, LEADER_SPAWN_DELAY_MS));
        }
    }

    console.log(`\n[Phase 1 Complete] ${leaders.length} leaders spawned.`);

    // Phase 2: Spawn workers in batches (much faster)
    console.log(`\n[Phase 2] Spawning ${numWorkers} workers in batches of ${WORKER_BATCH_SIZE}...`);

    let workerIndex = 0;
    for (let leaderIdx = 0; leaderIdx < leaders.length; leaderIdx++) {
        const leader = leaders[leaderIdx];
        console.log(`\n[Leader: ${leader.name}] Spawning ${leader.workerCount} workers...`);

        for (let batch = 0; batch < Math.ceil(leader.workerCount / WORKER_BATCH_SIZE); batch++) {
            const batchStart = batch * WORKER_BATCH_SIZE;
            const batchEnd = Math.min(batchStart + WORKER_BATCH_SIZE, leader.workerCount);
            const batchSize = batchEnd - batchStart;

            console.log(`  Batch ${batch + 1}: Spawning workers ${batchStart + 1}-${batchEnd}...`);

            // Spawn workers with small individual delays
            for (let i = batchStart; i < batchEnd; i++) {
                const workerName = getWorkerName(leader.name, i);
                workerIndex++;

                await Mindcraft.createWorker(workerName, leader.name, settings);

                // Small delay between individual workers
                if (i < batchEnd - 1) {
                    await new Promise(resolve => setTimeout(resolve, WORKER_INDIVIDUAL_DELAY_MS));
                }
            }

            // Brief delay between batches
            if (batchEnd < leader.workerCount) {
                await new Promise(resolve => setTimeout(resolve, WORKER_SPAWN_DELAY_MS));
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`HIERARCHY SPAWNING COMPLETE`);
    console.log(`  Leaders: ${leaders.length}`);
    console.log(`  Workers: ${workerIndex}`);
    console.log(`  Total: ${leaders.length + workerIndex}`);
    console.log(`========================================\n`);
}

// Start based on mode
if (settings.hierarchy_mode) {
    spawnHierarchy();
} else {
    spawnAgentsStaggered();
}