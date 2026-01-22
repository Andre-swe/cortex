/**
 * Soul State - Tracks emotional state and working memory for each bot
 */

class SoulState {
    constructor(botName, personality = {}) {
        this.botName = botName;
        this.personality = personality;

        // Emotional state
        this.emotion = 'calm';
        this.emotionIntensity = 0.5; // 0-1
        this.mood = 'neutral'; // longer-term emotional tendency
        this.emotionHistory = []; // track emotion changes
        this.lastEmotionChange = Date.now();
        this.emotionDecayRate = 0.1; // how fast emotions decay to neutral

        // Working memory - recent events/context
        this.workingMemory = [];
        this.maxMemorySize = 10;

        // Conversation state
        this.lastSpoke = 0;
        this.conversationPartner = null;
        this.silenceDuration = 0;

        // Activity state
        this.currentActivity = 'idle';
        this.currentGoal = null;

        // Social awareness
        this.recentSpeakers = [];
        this.botsWhoResponded = [];

        // Frustration/anger tracking
        this.frustrationLevel = 0; // 0-1, builds up with negative interactions
        this.grievances = []; // remember who annoyed them
    }

    /**
     * Update emotional state - affected by temperament
     */
    setEmotion(emotion, intensity = 0.5) {
        const previousEmotion = this.emotion;

        // Temperament affects how easily emotions change
        const volatility = this.personality.emotionalVolatility || 0.5;
        const angerThreshold = this.personality.angerThreshold || 0.5;

        // More volatile = emotions change more easily
        // Less volatile = emotions are more stable (stoic)
        const changeResistance = 1 - volatility;

        // Check if emotion should actually change based on volatility
        const isNegativeEmotion = ['angry', 'frustrated', 'annoyed', 'irritated', 'sad'].includes(emotion);
        const isPositiveEmotion = ['happy', 'excited', 'grateful', 'proud', 'playful'].includes(emotion);

        // For anger specifically, check against anger threshold
        if (emotion === 'angry') {
            // Need frustration to exceed threshold to become truly angry
            if (this.frustrationLevel < angerThreshold) {
                // Not angry enough yet - downgrade to annoyed or frustrated
                emotion = this.frustrationLevel > angerThreshold * 0.5 ? 'frustrated' : 'annoyed';
            }
        }

        // Stoic personalities resist emotional changes more
        if (changeResistance > 0.5 && previousEmotion === 'calm') {
            // Roll against resistance
            if (Math.random() < changeResistance - 0.3) {
                // Resist the change, stay calm
                console.log(`[${this.botName}] Resisted emotional change to ${emotion} (stoic temperament)`);
                return;
            }
        }

        // Apply emotion
        this.emotion = emotion;
        this.emotionIntensity = Math.max(0, Math.min(1, intensity * (0.5 + volatility * 0.5)));
        this.lastEmotionChange = Date.now();

        // Track emotion history
        this.emotionHistory.push({
            from: previousEmotion,
            to: emotion,
            intensity: this.emotionIntensity,
            timestamp: Date.now()
        });

        // Keep only last 10 emotion changes
        if (this.emotionHistory.length > 10) {
            this.emotionHistory.shift();
        }

        // Update personality's current emotion for cognitive engine access
        this.personality.currentEmotion = emotion;

        // Update frustration level based on negative emotions
        // Volatile personalities build frustration faster
        const frustrationGain = 0.2 * (0.5 + volatility * 0.5);
        if (['angry', 'frustrated', 'annoyed', 'irritated'].includes(emotion)) {
            this.frustrationLevel = Math.min(1, this.frustrationLevel + frustrationGain);
        } else if (['happy', 'calm', 'grateful'].includes(emotion)) {
            this.frustrationLevel = Math.max(0, this.frustrationLevel - 0.1);
        }

        console.log(`[${this.botName}] Emotion: ${previousEmotion} → ${emotion} (intensity: ${this.emotionIntensity.toFixed(2)}, frustration: ${this.frustrationLevel.toFixed(2)})`);
    }

    /**
     * Add a grievance (someone who annoyed this bot)
     */
    addGrievance(playerName, reason) {
        const existing = this.grievances.find(g => g.player === playerName);
        if (existing) {
            existing.count++;
            existing.lastTime = Date.now();
            existing.reasons.push(reason);
        } else {
            this.grievances.push({
                player: playerName,
                count: 1,
                lastTime: Date.now(),
                reasons: [reason]
            });
        }
    }

    /**
     * Check if this bot has a grievance with someone
     */
    hasGrievanceWith(playerName) {
        const grievance = this.grievances.find(g => g.player === playerName);
        if (!grievance) return false;
        // Grievances fade after 5 minutes
        return (Date.now() - grievance.lastTime) < 300000;
    }

    /**
     * Get frustration level with a specific player
     */
    getFrustrationWith(playerName) {
        const grievance = this.grievances.find(g => g.player === playerName);
        if (!grievance) return 0;
        // Decay over time
        const timeFactor = Math.max(0, 1 - (Date.now() - grievance.lastTime) / 300000);
        return Math.min(1, grievance.count * 0.2 * timeFactor);
    }

    /**
     * Decay emotion toward neutral over time
     */
    decayEmotion() {
        const timeSinceChange = Date.now() - this.lastEmotionChange;
        const decayTime = 60000; // 1 minute to start decaying

        if (timeSinceChange > decayTime) {
            // Gradually return to calm
            if (this.emotion !== 'calm' && this.emotionIntensity > 0.3) {
                this.emotionIntensity = Math.max(0.3, this.emotionIntensity - this.emotionDecayRate);
                if (this.emotionIntensity <= 0.3) {
                    this.setEmotion('calm', 0.5);
                }
            }
        }
    }

    /**
     * Add to working memory
     */
    addMemory(event) {
        this.workingMemory.push({
            ...event,
            timestamp: Date.now()
        });

        // Trim old memories
        if (this.workingMemory.length > this.maxMemorySize) {
            this.workingMemory.shift();
        }
    }

    /**
     * Record that this bot spoke
     */
    recordSpeaking() {
        this.lastSpoke = Date.now();
        this.silenceDuration = 0;
    }

    /**
     * Record that another bot responded
     */
    recordOtherBotResponse(botName) {
        if (!this.botsWhoResponded.includes(botName)) {
            this.botsWhoResponded.push(botName);
        }
    }

    /**
     * Clear response tracking (new conversation turn)
     */
    clearResponseTracking() {
        this.botsWhoResponded = [];
    }

    /**
     * Get time since last spoke
     */
    getTimeSinceSpoke() {
        return Date.now() - this.lastSpoke;
    }

    /**
     * Get context string for cognitive engine
     */
    getContextString() {
        const recentMemories = this.workingMemory
            .slice(-5)
            .map(m => `- ${m.type}: ${m.content}`)
            .join('\n');

        return `Bot: ${this.botName}
Personality: ${this.personality.description || 'friendly'}
Current emotion: ${this.emotion} (intensity: ${this.emotionIntensity.toFixed(1)})
Current activity: ${this.currentActivity}
Time since last spoke: ${Math.floor(this.getTimeSinceSpoke() / 1000)}s
Recent events:
${recentMemories || '(none)'}`;
    }

    /**
     * Get brief personality description
     */
    getPersonalityBrief() {
        const traits = [];
        if (this.personality.chattiness > 0.6) traits.push('talkative');
        if (this.personality.chattiness < 0.4) traits.push('quiet');
        if (this.personality.interests?.length > 0) {
            traits.push(`interested in ${this.personality.interests.slice(0, 2).join(' and ')}`);
        }
        return traits.join(', ') || 'balanced';
    }
}

/**
 * Soul State Manager - Manages states for all bots
 */
class SoulStateManager {
    constructor() {
        this.states = new Map();
        this.recentMessages = [];
        this.maxRecentMessages = 8;
    }

    /**
     * Get or create state for a bot
     */
    getState(botName, personality = {}) {
        if (!this.states.has(botName)) {
            this.states.set(botName, new SoulState(botName, personality));
        }
        return this.states.get(botName);
    }

    /**
     * Record a chat message
     */
    recordMessage(sender, message, isBot = false) {
        this.recentMessages.push({
            sender,
            message,
            isBot,
            timestamp: Date.now()
        });

        if (this.recentMessages.length > this.maxRecentMessages) {
            this.recentMessages.shift();
        }

        // Update all bot states with this new message
        for (const state of this.states.values()) {
            state.addMemory({
                type: isBot ? 'bot_chat' : 'player_chat',
                content: `${sender}: ${message}`
            });

            if (isBot && sender !== state.botName) {
                state.recordOtherBotResponse(sender);
            }
        }
    }

    /**
     * Get recent chat context as string
     */
    getRecentContext(limit = 5) {
        return this.recentMessages
            .slice(-limit)
            .map(m => `${m.sender}: ${m.message}`)
            .join('\n');
    }

    /**
     * Clear response tracking for new conversation turn
     */
    newConversationTurn() {
        for (const state of this.states.values()) {
            state.clearResponseTracking();
        }
    }

    /**
     * Get all bot names
     */
    getBotNames() {
        return Array.from(this.states.keys());
    }
}

// Singleton instance
const soulStateManager = new SoulStateManager();

export default soulStateManager;
export { SoulState, SoulStateManager };
