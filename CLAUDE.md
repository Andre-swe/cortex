# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindcraft is an AI-powered Minecraft bot framework that uses LLMs to control autonomous agents. Bots connect to Minecraft servers via Mineflayer and receive commands/context through natural language, generating actions via LLM inference.

## Common Commands

```bash
# Install dependencies (also runs patch-package via postinstall)
npm install

# Start the application
npm start
# or
node main.js

# Run with specific profile
node main.js --profiles ./profiles/andy.json

# Run with multiple agents
node main.js --profiles ./profiles/andy.json ./profiles/jill.json
```

There is no test suite or lint command exposed in package.json. ESLint is used internally for code generation validation.

## Architecture

### Process Model
- **main.js** → Entry point, initializes Mindcraft and spawns agents
- Each bot runs in a separate Node child process (AgentProcess in `src/process/agent_process.js`)
- **Mindserver** (`src/mindcraft/mindserver.js`) is a Socket.io hub coordinating all agents
- Web UI dashboard served on port 8080 by default

### Core Agent Flow
```
main.js → mindcraft.js → agent_process.js (child process) → init_agent.js → agent.js
```

The Agent class (`src/agent/agent.js`) orchestrates:
- **Conversation Manager**: Queues/batches player messages
- **Action Manager**: Executes commands or generated code
- **Coder**: LLM-based JavaScript generation with ESLint validation
- **Modes**: Autonomous behaviors (self_preservation, unstuck, cowardice, etc.)

### LLM Integration
- 20+ providers in `src/models/` (OpenAI, Anthropic, Google, Ollama, etc.)
- **Prompter** (`src/models/prompter.js`) builds context-aware prompts
- Model routing via `src/models/_model_map.js`
- Profiles can specify different models for chat, coding, vision, embedding

### Command System
- **Action commands** (`!command`): Direct execution (goToPlayer, craftRecipe, etc.)
- **Query commands** (`!?query`): Information requests (inventory, nearbyBlocks, etc.)
- Defined in `src/agent/commands/actions.js` and `src/agent/commands/queries.js`

### Code Generation & Security
- Generated code runs in SES sandbox (`src/agent/library/lockdown.js`)
- Only `skills` and `world` APIs exposed to generated code
- Templates in `bots/execTemplate.js` and `bots/lintTemplate.js`
- Disabled by default (`allow_insecure_coding: false` in settings.js)

### Soul System (Emotional State)
- `src/agent/soul/` contains emotional state tracking for bots
- **SoulState**: Tracks emotion, mood, frustration, working memory per bot
- **CognitiveEngine**: Processes events and generates emotional responses
- **RelationshipManager**: Tracks relationships between bots and players
- Emotions affected by personality traits (emotionalVolatility, angerThreshold)

### NPC Controller & Blueprints
- `src/agent/npc/controller.js` handles goal-driven NPC behavior
- Construction blueprints stored as JSON in `src/agent/npc/construction/`
- ItemGoal and BuildGoal classes manage autonomous tasks

### Skills Library
`src/agent/library/skills.js` contains 2000+ lines of executable bot actions (mining, crafting, navigation, combat, etc.)

## Configuration

### Global Settings
`settings.js` - Minecraft connection, ports, feature flags, behavior tuning
- Can be overridden via `SETTINGS_JSON` environment variable (JSON string)

### Bot Profiles
- Individual JSON files (e.g., `andy.json`, `profiles/claude.json`)
- Master template: `profiles/defaults/_default.json`
- Configures: model, personality prompts, enabled modes, examples

### Profile Model Format
```json
// Simple
"model": "gpt-4o"

// With provider prefix
"model": "anthropic/claude-sonnet-4-20250514"

// Advanced object
"model": {
  "api": "openai",
  "model": "gpt-4o",
  "url": "https://custom-endpoint.com"
}
```

## Key Directories

- `src/agent/` - Core agent logic, commands, skills, tasks, vision
- `src/models/` - LLM provider implementations
- `src/mindcraft/` - Mindserver, web UI, Minecraft server detection
- `profiles/` - Bot personality configurations
- `tasks/` - JSON task definitions for benchmarking
- `bots/` - Code execution templates and generated action code

## Running Tasks

```bash
# Run a task (benchmarking/automation)
node main.js --task_path tasks/basic/single_agent.json --task_id gather_oak_logs
```

Tasks define: goal prompts, initial inventory, target items/blueprints, timeouts, and blocked actions. See `minecollab.md` for advanced multi-agent task automation.

## Important Notes

- **Node version**: Use v18 or v20 LTS. Node v24+ causes native module build failures.
- **Native dependencies**: Canvas and gl packages require Python and C++ build tools. Use `npm install --no-optional` to skip gl if vision is not needed.
- **Patches**: Mineflayer modules are patched via patch-package (runs on npm install). Delete `node_modules` and re-run `npm install` after updates.
- **Multi-agent**: Each bot is a separate process; mindserver coordinates via Socket.io.
- **Vision ports**: Bot camera feeds available on localhost:3000-3003 when `render_bot_view: true`.
- **Docker**: Use `host.docker.internal` instead of `localhost` when running in Docker to connect to local Minecraft servers.
