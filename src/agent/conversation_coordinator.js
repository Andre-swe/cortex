/**
 * Conversation Coordinator - Soul-based conversation management
 * Uses cognitive engine for intelligent decision-making instead of random probabilities
 */

import soulStateManager from './soul/soul_state.js';
import { RelationshipManager } from './soul/relationship_manager.js';
import { sendSoulEvent } from './mindserver_proxy.js';

// Lazy load cognitive engine to avoid early API key access
let cognitiveEngine = null;
async function getCognitiveEngine() {
    if (!cognitiveEngine) {
        const module = await import('./soul/cognitive_engine.js');
        cognitiveEngine = module.default;
    }
    return cognitiveEngine;
}

class ConversationCoordinator {
    constructor() {
        this.lastResponse = {
            username: null,
            responder: null,
            timestamp: 0,
            message: null
        };
        this.pendingDecisions = new Map(); // Track in-flight decisions
        this.relationshipManagers = new Map(); // Per-bot relationship tracking
    }

    /**
     * Register a bot's personality traits
     */
    registerBot(name, personality = {}) {
        soulStateManager.getState(name, personality);

        // Create relationship manager for this bot
        if (!this.relationshipManagers.has(name)) {
            this.relationshipManagers.set(name, new RelationshipManager(name, personality));
            console.log(`[${name}] Relationship manager initialized`);
        }
    }

    /**
     * Get relationship manager for a bot
     */
    getRelationshipManager(botName) {
        return this.relationshipManagers.get(botName);
    }

    /**
     * Determine if this bot should respond to a message
     * Uses cognitive engine for actual reasoning instead of random dice
     */
    async shouldRespond(botName, username, message, otherBots = []) {
        const state = soulStateManager.getState(botName);
        const msgLower = message.toLowerCase();
        const botNameLower = botName.toLowerCase();

        // Quick check: directly mentioned = always respond fast
        if (msgLower.includes(botNameLower)) {
            state.setEmotion('attentive', 0.7);
            return {
                shouldRespond: true,
                delay: this.getBaseDelay(state, 'fast'),
                reason: 'directly_mentioned'
            };
        }

        // Check if another bot was specifically mentioned - likely skip
        const mentionedOther = otherBots.find(other =>
            other.toLowerCase() !== botNameLower &&
            msgLower.includes(other.toLowerCase())
        );
        if (mentionedOther) {
            return { shouldRespond: false, delay: 0, reason: 'other_bot_mentioned' };
        }

        // Use cognitive engine for intelligent decision
        try {
            const engine = await getCognitiveEngine();
            const decision = await engine.shouldRespond({
                botName,
                botPersonality: state.getPersonalityBrief(),
                message,
                sender: username,
                recentContext: soulStateManager.getRecentContext(4),
                otherBots: otherBots.filter(b => b !== botName),
                personality: state.personality // Pass full personality for chattiness, etc.
            });

            // Update emotional state with intensity based on context
            const emotionIntensity = decision.emotionInfluenced ? 0.8 : 0.5;
            state.setEmotion(decision.emotion || 'calm', emotionIntensity);

            // Track grievances for negative interactions
            if (['angry', 'frustrated', 'annoyed'].includes(decision.emotion)) {
                state.addGrievance(username, message.substring(0, 50));
            }

            if (decision.shouldRespond) {
                // Adjust delay based on emotion
                let urgency = 'normal';
                if (['angry', 'frustrated', 'irritated'].includes(decision.emotion)) {
                    urgency = 'fast'; // Angry responses come quick
                } else if (['excited', 'happy'].includes(decision.emotion)) {
                    urgency = 'fast';
                } else if (['bored', 'tired'].includes(decision.emotion)) {
                    urgency = 'slow';
                } else if (['cautious', 'worried'].includes(decision.emotion)) {
                    urgency = 'slow';
                }

                return {
                    shouldRespond: true,
                    delay: this.getBaseDelay(state, urgency),
                    reason: decision.reason,
                    emotion: decision.emotion
                };
            }

            return { shouldRespond: false, delay: 0, reason: decision.reason, emotion: decision.emotion };

        } catch (err) {
            // Fallback to simple logic if cognitive engine fails
            console.warn('Cognitive engine fallback:', err.message);
            return this.simpleFallback(botName, username, message, otherBots);
        }
    }

    /**
     * Simple fallback if cognitive engine is unavailable
     */
    simpleFallback(botName, username, message, otherBots) {
        const state = soulStateManager.getState(botName);
        const timeSinceLastResponse = Date.now() - this.lastResponse.timestamp;

        // If someone just responded, skip
        if (timeSinceLastResponse < 5000 && this.lastResponse.responder !== botName) {
            return { shouldRespond: false, delay: 0, reason: 'someone_responded' };
        }

        // Questions get responses
        if (message.includes('?')) {
            return {
                shouldRespond: true,
                delay: this.getBaseDelay(state, 'normal'),
                reason: 'question'
            };
        }

        // Low chance to respond otherwise
        if (Math.random() < 0.2) {
            return {
                shouldRespond: true,
                delay: this.getBaseDelay(state, 'slow'),
                reason: 'random'
            };
        }

        return { shouldRespond: false, delay: 0, reason: 'skipped' };
    }

    /**
     * Get delay based on state and urgency
     */
    getBaseDelay(state, urgency = 'normal') {
        const personality = state.personality || {};
        const baseDelay = personality.responseDelay || { min: 2000, max: 5000 };

        let multiplier = 1;
        switch (urgency) {
            case 'fast': multiplier = 0.5; break;
            case 'slow': multiplier = 1.5; break;
            case 'very_slow': multiplier = 2.5; break;
        }

        // Emotion affects speed
        if (state.emotion === 'excited') multiplier *= 0.7;
        if (state.emotion === 'cautious') multiplier *= 1.3;
        if (state.emotion === 'bored') multiplier *= 1.5;

        const min = baseDelay.min * multiplier;
        const max = baseDelay.max * multiplier;

        return Math.floor(Math.random() * (max - min) + min);
    }

    /**
     * Record that a bot responded
     */
    recordResponse(botName, username, message) {
        this.lastResponse = {
            username,
            responder: botName,
            timestamp: Date.now(),
            message
        };

        // Update state
        const state = soulStateManager.getState(botName);
        state.recordSpeaking();

        // Record message in global context
        soulStateManager.recordMessage(botName, message, true);
    }

    /**
     * Record incoming message and analyze for relationship tracking
     */
    recordIncomingMessage(sender, message, isBot = false) {
        soulStateManager.recordMessage(sender, message, isBot);

        // New message = new conversation turn
        if (!isBot) {
            soulStateManager.newConversationTurn();
        }

        // Track relationships for all bots
        for (const [botName, relManager] of this.relationshipManagers) {
            // Analyze the message to determine interaction type
            const interactionType = relManager.analyzeMessage(sender, message);

            // Record the interaction
            relManager.recordInteraction(sender, interactionType, {
                summary: message.substring(0, 50),
                isBot
            }, isBot);

            // Emit relationship event for significant changes
            const rel = relManager.getRelationship(sender);
            if (rel && rel.totalInteractions % 5 === 0) {
                sendSoulEvent(botName, {
                    type: 'relationship',
                    category: 'update',
                    target: sender,
                    relationship: rel.type,
                    trust: rel.trust,
                    fondness: rel.fondness,
                    interactions: rel.totalInteractions
                });
            }
        }
    }

    /**
     * Record a significant interaction (for trait evolution)
     */
    recordSignificantInteraction(botName, targetName, interactionType, details = {}) {
        const relManager = this.relationshipManagers.get(botName);
        if (relManager) {
            const rel = relManager.recordInteraction(targetName, interactionType, details);

            // Emit event
            sendSoulEvent(botName, {
                type: 'relationship',
                category: 'interaction',
                target: targetName,
                interactionType,
                newRelationship: rel.type,
                trust: rel.trust,
                fondness: rel.fondness
            });

            // Check for trait evolution
            const evolution = relManager.traitEvolution;
            if (evolution.traitHistory.length > 0) {
                const lastChange = evolution.traitHistory[evolution.traitHistory.length - 1];
                if (Date.now() - lastChange.timestamp < 5000) {
                    // Recent trait change - emit event
                    sendSoulEvent(botName, {
                        type: 'evolution',
                        category: 'trait_change',
                        changes: lastChange.changes,
                        xp: evolution.totalXP
                    });
                }
            }
        }
    }

    /**
     * Get evolved personality for a bot
     */
    getEvolvedPersonality(botName) {
        const relManager = this.relationshipManagers.get(botName);
        if (relManager) {
            return relManager.getEvolvedPersonality();
        }
        return null;
    }

    /**
     * Get relationship context between a bot and another entity
     */
    getRelationshipContext(botName, targetName) {
        const relManager = this.relationshipManagers.get(botName);
        if (relManager) {
            return relManager.getRelationshipContext(targetName);
        }
        return null;
    }

    /**
     * Save all relationship data
     */
    saveAllRelationships() {
        for (const relManager of this.relationshipManagers.values()) {
            relManager.save();
        }
    }

    /**
     * Get conversation context for prompting
     */
    getConversationContext(botName) {
        const state = soulStateManager.getState(botName);
        return {
            emotion: state.emotion,
            lastResponder: this.lastResponse.responder,
            recentContext: soulStateManager.getRecentContext(),
            timeSinceLastResponse: Date.now() - this.lastResponse.timestamp
        };
    }
}

// Singleton instance
const coordinator = new ConversationCoordinator();

export default coordinator;
export { ConversationCoordinator };
