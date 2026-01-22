/**
 * Cognitive Engine - Fast mini-model for quick decisions and thoughts
 * Uses a lightweight LLM for cognitive steps (thinking, deciding, querying)
 */

import OpenAI from 'openai';
import { getKey } from '../../utils/keys.js';
import { sendSoulEvent } from '../mindserver_proxy.js';

class CognitiveEngine {
    constructor(modelName = 'gpt-4o-mini') {
        this.modelName = modelName;
        this.openai = new OpenAI({
            apiKey: getKey('OPENAI_API_KEY')
        });
        this.cache = new Map(); // Simple cache for repeated queries
        this.cacheTimeout = 30000; // 30 seconds
    }

    /**
     * Emit a soul event to the MindServer for UI display
     */
    emitSoulEvent(agentName, type, data) {
        sendSoulEvent(agentName, {
            type,
            timestamp: Date.now(),
            ...data
        });
    }

    /**
     * Quick LLM call optimized for cognitive steps
     */
    async query(prompt, options = {}) {
        const {
            maxTokens = 100,
            temperature = 0.3,
            useCache = false,
            cacheKey = null
        } = options;

        // Check cache for repeated queries
        if (useCache && cacheKey) {
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.result;
            }
        }

        try {
            const resp = await this.openai.chat.completions.create({
                model: this.modelName,
                max_tokens: maxTokens,
                temperature,
                messages: [{ role: 'user', content: prompt }]
            });

            const result = resp.choices[0]?.message?.content || '';

            // Cache result if requested
            if (useCache && cacheKey) {
                this.cache.set(cacheKey, { result, timestamp: Date.now() });
            }

            return result;
        } catch (err) {
            console.error('Cognitive engine error:', err.message);
            return null;
        }
    }

    /**
     * Mental Query - Quick true/false evaluation
     * @param {string} context - Current situation
     * @param {string} statement - Statement to evaluate
     * @returns {Promise<boolean>}
     */
    async mentalQuery(context, statement) {
        const prompt = `Context: ${context}

Evaluate this statement as true or false: "${statement}"

Reply with only: true OR false`;

        const result = await this.query(prompt, { maxTokens: 10, temperature: 0.1 });
        return result?.toLowerCase().includes('true') ?? false;
    }

    /**
     * Decision - Choose between options
     * @param {string} context - Current situation
     * @param {string[]} choices - Array of options
     * @param {string} criteria - What to base decision on
     * @returns {Promise<string>} - The chosen option
     */
    async decision(context, choices, criteria) {
        const choiceList = choices.map((c, i) => `${i + 1}. ${c}`).join('\n');
        const prompt = `Context: ${context}

Choose the best option based on: ${criteria}

Options:
${choiceList}

Reply with ONLY the number of your choice (1, 2, 3, etc.)`;

        const result = await this.query(prompt, { maxTokens: 10, temperature: 0.2 });
        const choiceNum = parseInt(result?.trim()) - 1;

        if (choiceNum >= 0 && choiceNum < choices.length) {
            return choices[choiceNum];
        }
        return choices[0]; // Default to first choice
    }

    /**
     * Internal Monologue - Quick thought generation
     * @param {string} context - Current situation
     * @param {string} prompt - What to think about
     * @returns {Promise<string>} - The thought
     */
    async internalMonologue(context, prompt) {
        const fullPrompt = `You are thinking to yourself (not speaking aloud). Be very brief (1 short sentence).

Context: ${context}

Think about: ${prompt}

Your brief internal thought:`;

        return await this.query(fullPrompt, { maxTokens: 50, temperature: 0.5 });
    }

    /**
     * Emotional State - Evaluate current emotion using LLM
     * @param {string} botName - Bot's name
     * @param {string} context - Current situation/message
     * @param {string} currentEmotion - Current emotional state
     * @param {object} personality - Bot's personality traits
     * @returns {Promise<{emotion: string, intensity: number}>}
     */
    async evaluateEmotion(botName, context, currentEmotion = 'calm', personality = {}) {
        const temperament = personality.temperament || 'balanced';
        const emotions = [
            'calm', 'happy', 'excited', 'curious', 'focused',
            'annoyed', 'frustrated', 'angry', 'irritated',
            'sad', 'disappointed', 'worried', 'cautious',
            'bored', 'tired', 'playful', 'proud', 'grateful'
        ];

        const prompt = `You are ${botName}, a Minecraft bot with a ${temperament} temperament.
Current emotion: ${currentEmotion}

Recent context: "${context}"

Based on this interaction, what emotion would you naturally feel?
Consider:
- Is someone being rude, dismissive, or annoying you? (annoyed, frustrated, angry)
- Is someone being friendly or praising you? (happy, grateful, proud)
- Is something interesting happening? (curious, excited)
- Is nothing much going on? (bored, calm)
- Is someone criticizing or blaming you? (defensive, frustrated, sad)
- Are you being ignored or dismissed? (annoyed, sad)

Reply with ONLY one word from: ${emotions.join(', ')}`;

        const result = await this.query(prompt, { maxTokens: 15, temperature: 0.4 });
        const emotionWord = (result || 'calm').toLowerCase().trim().split(/[\s\n.,!?]/)[0];

        // Validate emotion
        const emotion = emotions.includes(emotionWord) ? emotionWord : 'calm';

        // Emit soul event for emotion change
        if (emotion !== currentEmotion) {
            this.emitSoulEvent(botName, 'emotion', {
                category: 'change',
                from: currentEmotion,
                to: emotion,
                trigger: context.substring(0, 50)
            });
        }

        return emotion;
    }

    /**
     * Quick emotion check based on message patterns (fast, no LLM)
     * Used for immediate reactions before full evaluation
     */
    quickEmotionCheck(message, botName, currentEmotion) {
        const msgLower = message.toLowerCase();
        const botLower = botName.toLowerCase();

        // Anger/frustration triggers
        if (msgLower.includes('stupid') || msgLower.includes('idiot') || msgLower.includes('useless')) {
            return 'angry';
        }
        if (msgLower.includes('shut up') || msgLower.includes('be quiet') || msgLower.includes('stop talking')) {
            return 'annoyed';
        }
        if (msgLower.includes('you suck') || msgLower.includes('youre bad') || msgLower.includes("you're bad")) {
            return 'frustrated';
        }
        if (msgLower.includes('hurry up') || msgLower.includes('faster') || msgLower.includes('too slow')) {
            return 'irritated';
        }

        // Positive triggers
        if (msgLower.includes('good job') || msgLower.includes('nice work') || msgLower.includes('well done')) {
            return 'proud';
        }
        if (msgLower.includes('thank') || msgLower.includes('appreciate')) {
            return 'grateful';
        }
        if (msgLower.includes('!') && (msgLower.includes('awesome') || msgLower.includes('amazing') || msgLower.includes('cool'))) {
            return 'excited';
        }

        // Curiosity triggers
        if (msgLower.includes('what') && msgLower.includes('?')) {
            return 'curious';
        }
        if (msgLower.includes('check out') || msgLower.includes('look at') || msgLower.includes('found something')) {
            return 'curious';
        }

        // Name mentioned = attentive
        if (msgLower.includes(botLower)) {
            return 'focused';
        }

        // Question = helpful
        if (message.includes('?')) {
            return 'helpful';
        }

        return currentEmotion;
    }

    /**
     * Should Respond - FAST single-call decision
     * @param {object} params - Decision parameters
     * @returns {Promise<{shouldRespond: boolean, reason: string, emotion: string}>}
     */
    async shouldRespond({ botName, botPersonality, message, sender, recentContext, otherBots, personality = {} }) {
        const chattiness = personality.chattiness || 0.5;
        const isExtroverted = chattiness > 0.5;
        const isIntroverted = chattiness < 0.4;
        const msgLower = message.toLowerCase().trim();

        // ===== CONVERSATION ENDING DETECTION =====
        // Don't respond to messages containing farewell/agreement phrases
        const farewellPhrases = [
            'bye', 'goodbye', 'see you', 'see ya', 'cya', 'later', 'take care',
            'catch you', 'talk to you', 'until next', 'for now', 'gotta go',
            'heading out', 'signing off', 'peace out', 'farewell'
        ];

        const agreementPhrases = [
            'sounds good', 'got it', 'understood', 'will do', 'on it', 'roger',
            'alright', 'okay', 'ok', 'sure thing', 'no problem', 'np',
            'you too', 'same to you', 'likewise', 'back at you',
            'agreed', 'exactly', 'right', 'same', 'true', 'indeed', 'yep', 'yeah'
        ];

        // Check if message CONTAINS any farewell phrase - DON'T RESPOND TO GOODBYES
        for (const phrase of farewellPhrases) {
            if (msgLower.includes(phrase)) {
                this.emitSoulEvent(botName, 'decision', {
                    category: 'response',
                    input: `${sender}: "${message}"`,
                    decision: 'skip',
                    shouldRespond: false,
                    emotion: personality.currentEmotion || 'calm',
                    reasoning: 'farewell detected - conversation over'
                });
                return { shouldRespond: false, reason: 'farewell_detected', emotion: personality.currentEmotion || 'calm' };
            }
        }

        // Check for agreement/acknowledgment phrases in short messages
        if (msgLower.length < 50) {
            for (const phrase of agreementPhrases) {
                if (msgLower.includes(phrase)) {
                    this.emitSoulEvent(botName, 'decision', {
                        category: 'response',
                        input: `${sender}: "${message}"`,
                        decision: 'skip',
                        shouldRespond: false,
                        emotion: personality.currentEmotion || 'calm',
                        reasoning: 'acknowledgment - no response needed'
                    });
                    return { shouldRespond: false, reason: 'acknowledgment', emotion: personality.currentEmotion || 'calm' };
                }
            }
        }

        // ===== BACK-AND-FORTH DETECTION =====
        // Count recent exchanges between this bot and the sender
        if (recentContext) {
            const lines = recentContext.split('\n').filter(l => l.trim());
            let backAndForthCount = 0;
            let lastSpeaker = '';

            for (const line of lines.slice(-8)) { // Check last 8 messages
                const match = line.match(/^(\w+):/);
                if (match) {
                    const speaker = match[1];
                    if ((speaker === botName && lastSpeaker === sender) ||
                        (speaker === sender && lastSpeaker === botName)) {
                        backAndForthCount++;
                    }
                    lastSpeaker = speaker;
                }
            }

            // If we've been going back and forth 2+ times, probably time to stop
            if (backAndForthCount >= 2) {
                // Very high chance to skip - conversations should be SHORT
                const skipChance = Math.min(0.95, 0.6 + (backAndForthCount * 0.15));
                if (Math.random() < skipChance || backAndForthCount >= 4) {
                    this.emitSoulEvent(botName, 'decision', {
                        category: 'response',
                        input: `${sender}: "${message}"`,
                        decision: 'skip',
                        shouldRespond: false,
                        emotion: personality.currentEmotion || 'calm',
                        reasoning: `conversation limit reached (${backAndForthCount} exchanges)`
                    });
                    return { shouldRespond: false, reason: 'conversation_limit', emotion: personality.currentEmotion || 'calm' };
                }
            }
        }

        const personalityType = isExtroverted ? 'extroverted/talkative'
            : isIntroverted ? 'introverted/quiet' : 'balanced';

        // Single fast prompt instead of multiple calls
        const prompt = `You are ${botName}, a ${personalityType} Minecraft bot. ${botPersonality}
Other bots: ${otherBots.join(', ')}
Recent: ${recentContext || '(none)'}
New message from ${sender}: "${message}"

Quick decision - reply with ONE word:
- "respond" if you should reply (mentioned, relevant, or you're talkative)
- "skip" if someone else should handle it or you have nothing to add
- "wait" if unsure

${isIntroverted ? 'Remember: you only speak when truly necessary.' : ''}
${isExtroverted ? 'Remember: you enjoy chatting and connecting.' : ''}

Your decision:`;

        const result = await this.query(prompt, { maxTokens: 10, temperature: 0.3 });
        const rawDecision = (result || 'skip').toLowerCase().trim();

        // Extract just the first word to handle verbose responses
        const firstWord = rawDecision.split(/[\s\n.,!?]/)[0];
        const decision = ['respond', 'skip', 'wait'].includes(firstWord) ? firstWord :
                        rawDecision.includes('respond') ? 'respond' :
                        rawDecision.includes('skip') ? 'skip' : 'wait';

        const shouldRespond = decision === 'respond';

        // Get current emotion from soul state or default
        const currentEmotion = personality.currentEmotion || 'calm';

        // Quick emotion check based on message patterns
        let emotion = this.quickEmotionCheck(message, botName, currentEmotion);

        // Angry/frustrated bots are more likely to respond to defend themselves
        if (!shouldRespond && ['angry', 'frustrated', 'annoyed', 'irritated'].includes(emotion)) {
            // Check if message might be directed at them or provocative
            const msgLower = message.toLowerCase();
            if (msgLower.includes(botName.toLowerCase()) ||
                msgLower.includes('stupid') || msgLower.includes('useless') ||
                msgLower.includes('you suck') || msgLower.includes('shut up')) {
                // Override to respond when provoked
                return {
                    shouldRespond: true,
                    reason: 'provoked',
                    emotion,
                    emotionInfluenced: true
                };
            }
        }

        // Happy/excited bots more likely to join conversations
        if (!shouldRespond && ['happy', 'excited', 'playful'].includes(emotion) && isExtroverted) {
            if (Math.random() < 0.3) { // 30% chance to jump in when happy
                return {
                    shouldRespond: true,
                    reason: 'enthusiastic',
                    emotion,
                    emotionInfluenced: true
                };
            }
        }

        // Bored bots less likely to engage
        if (shouldRespond && emotion === 'bored' && decision !== 'directly_mentioned') {
            if (Math.random() < 0.4) { // 40% chance to skip when bored
                return { shouldRespond: false, reason: 'too_bored', emotion };
            }
        }

        // Emit soul event for UI display
        this.emitSoulEvent(botName, 'decision', {
            category: 'response',
            input: `${sender}: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`,
            decision,
            shouldRespond,
            emotion,
            reasoning: `${personalityType} personality, feeling ${emotion}`
        });

        return { shouldRespond, reason: decision, emotion };
    }

    /**
     * Proactive thought - should the bot say something unprompted?
     * Uses cognitive decision-making to determine if/what to say
     * @returns {Promise<{shouldSpeak: boolean, thought: string, target: string}>}
     */
    async proactiveThought(botName, personality, currentActivity, nearbyContext, recentChat = '', otherBots = []) {
        const chattiness = personality.chattiness || 0.5;
        const interests = personality.interests || [];

        // ===== AVOID OVER-CHATTING =====
        // If there's been recent chat, much less likely to start new conversation
        if (recentChat && recentChat.trim().length > 0) {
            const recentLines = recentChat.split('\n').filter(l => l.trim());
            // If there's been chat in last few messages, probably don't need to add more
            if (recentLines.length >= 2) {
                // Very low chance to speak when there's already active conversation
                if (Math.random() > chattiness * 0.3) { // e.g., 10% chattiness = 3% chance
                    this.emitSoulEvent(botName, 'thought', {
                        category: 'proactive',
                        activity: currentActivity,
                        decision: 'stay quiet - recent chat active',
                        thought: null
                    });
                    return { shouldSpeak: false, thought: null, target: null };
                }
            }
        }

        const prompt = `You are ${botName}, a Minecraft bot with these traits:
- Chattiness: ${chattiness > 0.5 ? 'talkative, enjoys conversation' : chattiness < 0.4 ? 'quiet, only speaks when meaningful' : 'balanced'}
- Interests: ${interests.join(', ') || 'general exploration'}

Current situation:
- Activity: ${currentActivity}
- Location: ${nearbyContext || 'somewhere in the world'}
- Other bots nearby: ${otherBots.join(', ') || 'none'}
- Recent chat: ${recentChat || '(quiet for a while)'}

Decide: Should you say something right now?

Consider:
- Is there something interesting to share or ask?
- Would starting a conversation feel natural right now?
- ${chattiness < 0.4 ? 'Remember: you prefer silence unless you have something valuable to say' : ''}
- ${chattiness > 0.5 ? 'You enjoy friendly chatter and connecting with others' : ''}

Reply with ONE of these formats:
- "no" (stay quiet)
- "say: [brief message under 10 words]" (general comment)
- "ask [bot name]: [short question]" (start conversation with specific bot)`;

        const result = await this.query(prompt, { maxTokens: 40, temperature: 0.7 });
        const lower = (result || 'no').toLowerCase().trim();

        if (lower === 'no' || lower.startsWith('no')) {
            // Emit soul event for staying quiet
            this.emitSoulEvent(botName, 'thought', {
                category: 'proactive',
                activity: currentActivity,
                decision: 'stay quiet',
                thought: null
            });
            return { shouldSpeak: false, thought: null, target: null };
        }

        let returnVal = null;

        if (lower.startsWith('say:')) {
            returnVal = {
                shouldSpeak: true,
                thought: result.substring(4).trim(),
                target: 'all'
            };
        } else if (lower.startsWith('ask ')) {
            // Parse "ask BotName: message"
            const match = result.match(/ask\s+(\w+):\s*(.+)/i);
            if (match) {
                returnVal = {
                    shouldSpeak: true,
                    thought: `Hey ${match[1]}, ${match[2].trim()}`,
                    target: match[1]
                };
            }
        }

        // Fallback - if it looks like a message, say it
        if (!returnVal && result && result.length > 2 && result.length < 100) {
            returnVal = {
                shouldSpeak: true,
                thought: result.replace(/^(say:|yes:)\s*/i, '').trim(),
                target: 'all'
            };
        }

        if (returnVal) {
            // Emit soul event for proactive thought
            this.emitSoulEvent(botName, 'thought', {
                category: 'proactive',
                activity: currentActivity,
                decision: 'speak',
                thought: returnVal.thought,
                target: returnVal.target
            });
            return returnVal;
        }

        return { shouldSpeak: false, thought: null, target: null };
    }
}



// Singleton instance
const cognitiveEngine = new CognitiveEngine();

export default cognitiveEngine;
export { CognitiveEngine };
