# Cortex

**An orchestration layer for understanding and controlling swarms of AI agents.**

Cortex is a neural command center that enables real-time visualization, coordination, and control of 100+ autonomous AI agents. Originally built for Minecraft, the architecture is designed to scale across any multi-agent system.

![Orchestration](https://img.shields.io/badge/Orchestration-Multi--Agent-purple)
![Scale](https://img.shields.io/badge/Scale-100%2B%20Agents-blue)
![Real-time](https://img.shields.io/badge/Monitoring-Real--time-green)

---

## What is Cortex?

Cortex provides a **hive-mind interface** for managing large-scale AI agent deployments:

- **Visualize** agent networks in real-time with an interactive neural graph
- **Monitor** agent thoughts, emotions, commands, and status updates
- **Coordinate** hierarchical agent structures (leaders commanding workers)
- **Optimize** costs by batching LLM calls and using lightweight worker agents

Think of it as mission control for your AI swarm.

---

## Core Features

### Neural Network Visualization
Interactive canvas showing all agents as nodes in a network:
- Leaders displayed as large pulsing nodes
- Workers cluster around their assigned leaders
- Connection lines show command flow and relationships
- Real-time position and status updates

### Unified Activity Feed
All agent activity categorized and filterable:
- **CHAT** - In-game messages between agents/players
- **THOUGHTS** - Internal LLM reasoning and decisions
- **EMOTIONS** - Soul state changes (calm, angry, focused, etc.)
- **COMMANDS** - Leader-to-worker directives
- **STATUS** - Task completion and error reports

### Soul System
Each agent has emotional intelligence:
- Dynamic mood states influenced by events
- Relationship tracking between agents
- Trust levels that affect cooperation
- Personality-driven behavior patterns

### Bot Vision Integration
Live camera feeds from agent perspectives:
- Real-time view of what each leader sees
- Embedded directly in the Cortex UI
- Useful for debugging and monitoring

---

## Architecture

```
                      +------------------+
                      |     CORTEX       |
                      |   Neural Command |
                      |      Center      |
                      +--------+---------+
                               |
                      +--------+---------+
                      |   MindServer     |
                      |  Orchestration   |
                      |     Layer        |
                      +--------+---------+
                               |
         +---------------------+---------------------+
         |                     |                     |
   +-----+-----+         +-----+-----+         +-----+-----+
   |   ALPHA   |         |   BETA    |         |   GAMMA   |
   |  (Leader) |         |  (Leader) |         |  (Leader) |
   |  Full LLM |         |  Full LLM |         |  Full LLM |
   +-----+-----+         +-----+-----+         +-----+-----+
         |                     |                     |
   +-----+-----+         +-----+-----+         +-----+-----+
   |  Workers  |         |  Workers  |         |  Workers  |
   |   1-33    |         |   34-66   |         |   67-97   |
   +-----------+         +-----------+         +-----------+
```

### Leader-Worker Hierarchy
- **Leaders (3)**: Full LLM capabilities, strategic decision-making, 45-second thought cycles
- **Workers (97)**: Lightweight executors, instant command response, zero LLM cost

### Cost Optimization

| Deployment | Agents | API Calls/Hour | Cost/Hour |
|------------|--------|----------------|-----------|
| Traditional | 100 | ~6,000 | $18.00 |
| Cortex | 100 | ~600 | $1.80 |
| **Savings** | - | **90%** | **$16.20** |

---

## Quick Start

### Requirements
- Node.js v18 or v20 LTS
- Minecraft Java Edition (for Minecraft deployment)
- API key (OpenAI, Anthropic, or 15+ other providers)

### Installation

```bash
git clone https://github.com/Andre-swe/cortex.git
cd cortex
npm install
cp keys.example.json keys.json
# Add your API keys to keys.json
```

### Configuration

Edit `settings.js`:
```javascript
{
    "host": "localhost",              // Your server
    "port": 25565,                    // Server port
    "hierarchy_mode": true,           // Enable swarm mode
    "thought_tick_interval": 45000,   // Leader think cycle (ms)
}
```

### Launch

**Standard (3 agents):**
```bash
node main.js
```

**Swarm Mode (100 agents):**
```bash
node main.js --hierarchy --leaders 3 --workers 97
```

### Access Cortex UI
Open `http://localhost:8080/cortex.html`

---

## Leader Commands

Leaders coordinate workers with these directives:

| Command | Description |
|---------|-------------|
| `!commandWorker(name, task)` | Direct command to specific worker |
| `!allWorkersCollect(item, n)` | Mass resource gathering |
| `!allWorkersFollow` | Rally all workers to leader |
| `!allWorkersDefend` | Defensive formation |
| `!getWorkerStatus()` | Query all worker states |
| `!recallWorkers()` | Emergency recall |

---

## Project Structure

```
cortex/
├── src/
│   ├── mindcraft/
│   │   ├── mindserver.js      # Central orchestration
│   │   ├── command_relay.js   # Leader→Worker routing
│   │   └── public/
│   │       └── cortex.html    # Neural command UI
│   ├── agent/
│   │   ├── agent.js           # Full LLM agent
│   │   ├── worker_bot.js      # Lightweight worker
│   │   └── soul/              # Emotion system
│   │       ├── soul_state.js
│   │       ├── cognitive_engine.js
│   │       └── relationship_manager.js
│   └── models/                # 20+ LLM providers
├── profiles/
│   ├── leaders/               # Alpha, Beta, Gamma configs
│   └── workers/               # Worker template
├── stream/                    # OBS streaming overlays
└── settings.js                # Global configuration
```

---

## Supported Providers

| Provider | Key | Notes |
|----------|-----|-------|
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4 |
| Anthropic | `ANTHROPIC_API_KEY` | Claude 3.5/3 |
| Google | `GEMINI_API_KEY` | Gemini Pro/Flash |
| DeepSeek | `DEEPSEEK_API_KEY` | Cost-effective |
| Ollama | Local | Self-hosted |
| + 15 more | See `keys.example.json` | |

---

## Resource Usage

| Component | Leader | Worker |
|-----------|--------|--------|
| Memory | ~25 MB | ~16 MB |
| LLM Calls | Yes | No |
| Autonomy | Full | Command-only |

**100 agents**: ~1.6 GB RAM total

---

## Streaming Integration

Built-in OBS overlays in `stream/`:
- `obs_overlay.html` - Main overlay
- `neural_ticker.html` - Activity feed
- `relationship_graph.html` - Agent connections
- `bot_status_panel.html` - Status display

---

## Extending Cortex

Cortex's architecture is modular. Key extension points:

1. **New Agent Types**: Extend `worker_bot.js` for specialized workers
2. **Custom Commands**: Add to `src/agent/commands/actions.js`
3. **UI Customization**: Modify `cortex.html` for different visualizations
4. **New Providers**: Add LLM integrations in `src/models/`

---

## Safety

> **Warning**: The `allow_insecure_coding` option permits LLM-generated code execution. Use Docker for isolation when enabled.

```bash
docker build -t cortex .
docker run -p 8080:8080 -p 3000-3003:3000-3003 cortex
```

---

## License

MIT License - See [LICENSE](LICENSE)

---

<p align="center">
  <strong>Cortex</strong> - Command your swarm.
</p>
