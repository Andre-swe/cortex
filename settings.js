const settings = {
    "minecraft_version": "auto", // or specific version like "1.21.6"
    "host": "148.113.198.238", // or "your.server.ip.here"
    "port": 27000, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 27004,
    "auto_open_ui": false, // opens UI in browser on startup

    // Hierarchy mode for 100-agent scaling with leaders and workers
    "hierarchy_mode": true, // enable leader-worker hierarchy
    "thought_tick_interval": 45000, // ms between batched LLM calls for leaders (45 seconds)
    "workers_per_leader": 32, // number of workers assigned to each leader
    "worker_spawn_delay": 12000, // ms delay between worker spawns (increased to reduce server load)
    "worker_spawn_batch_size": 2, // number of workers to spawn in parallel (reduced batch size)
    "hierarchy": {
        // Leaders with full LLM capabilities (30-second thought tick)
        "leaders": [
            { "profile": "./profiles/leaders/alpha.json", "workers": 33 },
            { "profile": "./profiles/leaders/beta.json", "workers": 33 },
            { "profile": "./profiles/leaders/gamma.json", "workers": 31 }
        ],
        // Worker template (no LLM, executes commands only)
        "worker_template": "./profiles/workers/worker_template.json"
    },

    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./profiles/explorer_marco.json",
        "./profiles/explorer_ada.json",
        "./profiles/explorer_jules.json",
        // "./andy.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // Supports up to 75 messages!

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],

    "load_memory": true, // load memory from previous session
    "init_message": "You are a LEADER bot. Set an autonomous goal: !goal(\"Survive and build a base. 1. Gather resources with workers. 2. Build shelter. 3. Explore and expand.\"). Use !nearbyBlocks to see around. Command workers: !allWorkersCollect(\"oak_log\", 20), !allWorkersFollow. Build with: !newAction(\"Build a small house\"). ALWAYS use commands!", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": true, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": true, // allows newAction command for building structures autonomously
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel", "!attack", "!attackPlayer"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": false, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file

}

if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse SETTINGS_JSON:", err);
    }
}

export default settings;
