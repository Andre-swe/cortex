/**
 * Relationship Manager - Tracks relationships and evolves bot personality over time
 * Enables emergent behavior through learned experiences
 */

import fs from 'fs';
import path from 'path';
import { sendRelationshipUpdate } from '../mindserver_proxy.js';

class Relationship {
    constructor(targetName, isBot = false) {
        this.target = targetName;
        this.isBot = isBot;

        // Core relationship metrics (-1 to 1)
        this.trust = 0;          // How much they trust this entity
        this.fondness = 0;       // How much they like them
        this.respect = 0;        // How much they respect them

        // Interaction history
        this.totalInteractions = 0;
        this.positiveInteractions = 0;
        this.negativeInteractions = 0;
        this.lastInteraction = null;

        // Memory of significant events
        this.memories = [];
        this.maxMemories = 10;

        // Relationship type (emerges from metrics)
        this.type = 'stranger'; // stranger, acquaintance, friend, bestFriend, rival, enemy
    }

    /**
     * Record an interaction and update relationship
     */
    recordInteraction(type, details = {}) {
        this.totalInteractions++;
        this.lastInteraction = Date.now();

        const impactMap = {
            // Positive interactions
            'helped': { trust: 0.1, fondness: 0.1, respect: 0.05 },
            'complimented': { trust: 0.05, fondness: 0.15, respect: 0.05 },
            'thanked': { trust: 0.05, fondness: 0.1, respect: 0.05 },
            'gifted': { trust: 0.1, fondness: 0.2, respect: 0.1 },
            'defended': { trust: 0.15, fondness: 0.15, respect: 0.1 },
            'goodConversation': { trust: 0.05, fondness: 0.1, respect: 0.05 },
            'laughedTogether': { trust: 0.05, fondness: 0.15, respect: 0 },
            'sharedGoal': { trust: 0.1, fondness: 0.1, respect: 0.1 },

            // Negative interactions
            'insulted': { trust: -0.15, fondness: -0.2, respect: -0.1 },
            'ignored': { trust: -0.05, fondness: -0.1, respect: -0.05 },
            'attacked': { trust: -0.3, fondness: -0.3, respect: -0.1 },
            'betrayed': { trust: -0.4, fondness: -0.3, respect: -0.2 },
            'mocked': { trust: -0.1, fondness: -0.15, respect: -0.1 },
            'interrupted': { trust: -0.05, fondness: -0.05, respect: -0.1 },
            'commanded': { trust: 0, fondness: -0.05, respect: -0.05 },
            'dismissed': { trust: -0.1, fondness: -0.1, respect: -0.15 },

            // Neutral/context-dependent
            'collaborated': { trust: 0.05, fondness: 0.05, respect: 0.1 },
            'chatted': { trust: 0.02, fondness: 0.03, respect: 0 },
            'observed': { trust: 0, fondness: 0, respect: 0.02 },
        };

        const impact = impactMap[type] || { trust: 0, fondness: 0, respect: 0 };

        // Apply impact with diminishing returns
        this.trust = this.applyChange(this.trust, impact.trust);
        this.fondness = this.applyChange(this.fondness, impact.fondness);
        this.respect = this.applyChange(this.respect, impact.respect);

        // Track positive/negative
        if (impact.fondness > 0) {
            this.positiveInteractions++;
        } else if (impact.fondness < 0) {
            this.negativeInteractions++;
        }

        // Record significant memories
        if (Math.abs(impact.fondness) >= 0.1 || Math.abs(impact.trust) >= 0.1) {
            this.addMemory(type, details);
        }

        // Update relationship type
        this.updateType();
    }

    /**
     * Apply change with diminishing returns near extremes
     */
    applyChange(current, delta) {
        // Harder to change when already at extremes
        const resistance = Math.abs(current) * 0.5;
        const effectiveDelta = delta * (1 - resistance);
        return Math.max(-1, Math.min(1, current + effectiveDelta));
    }

    /**
     * Add a memory of significant interaction
     */
    addMemory(type, details) {
        this.memories.push({
            type,
            details,
            timestamp: Date.now(),
            emotional: this.fondness > 0.3 ? 'positive' : this.fondness < -0.3 ? 'negative' : 'neutral'
        });

        if (this.memories.length > this.maxMemories) {
            this.memories.shift();
        }
    }

    /**
     * Update relationship type based on metrics
     */
    updateType() {
        const avg = (this.trust + this.fondness + this.respect) / 3;

        if (avg > 0.6) {
            this.type = 'bestFriend';
        } else if (avg > 0.3) {
            this.type = 'friend';
        } else if (avg > 0.1) {
            this.type = 'acquaintance';
        } else if (avg > -0.2) {
            this.type = 'stranger';
        } else if (avg > -0.5) {
            this.type = 'rival';
        } else {
            this.type = 'enemy';
        }
    }

    /**
     * Get relationship summary for cognitive engine
     */
    getSummary() {
        const recentMemory = this.memories[this.memories.length - 1];
        return {
            target: this.target,
            type: this.type,
            trust: this.trust.toFixed(2),
            fondness: this.fondness.toFixed(2),
            respect: this.respect.toFixed(2),
            interactions: this.totalInteractions,
            recentMemory: recentMemory ? `${recentMemory.type}: ${recentMemory.details.summary || ''}` : null
        };
    }

    /**
     * Natural decay - relationships fade toward neutral over time
     */
    decay(hours = 1) {
        const decayRate = 0.01 * hours;
        this.trust *= (1 - decayRate);
        this.fondness *= (1 - decayRate);
        this.respect *= (1 - decayRate);
        this.updateType();
    }

    toJSON() {
        return {
            target: this.target,
            isBot: this.isBot,
            trust: this.trust,
            fondness: this.fondness,
            respect: this.respect,
            totalInteractions: this.totalInteractions,
            positiveInteractions: this.positiveInteractions,
            negativeInteractions: this.negativeInteractions,
            lastInteraction: this.lastInteraction,
            memories: this.memories,
            type: this.type
        };
    }

    static fromJSON(data) {
        const rel = new Relationship(data.target, data.isBot);
        Object.assign(rel, data);
        return rel;
    }
}

class TraitEvolution {
    constructor(personality) {
        this.basePersonality = { ...personality };
        this.currentPersonality = { ...personality };

        // Track experiences that affect traits
        this.experiences = {
            socialSuccess: 0,      // Good conversations → more chattiness
            socialFailure: 0,      // Ignored/rejected → less chattiness
            conflictWins: 0,       // Standing ground → lower anger threshold
            conflictLosses: 0,     // Being dominated → higher anger threshold
            explorationSuccess: 0, // Finding cool things → more curiosity
            helpingOthers: 0,      // Helping → more altruistic
            beingHelped: 0,        // Receiving help → more trusting
            betrayals: 0,          // Being betrayed → less trusting
        };

        // Trait change history
        this.traitHistory = [];
        this.totalXP = 0;
    }

    /**
     * Record an experience that may evolve traits
     */
    recordExperience(type, intensity = 1) {
        if (this.experiences.hasOwnProperty(type)) {
            this.experiences[type] += intensity;
        }

        // XP system
        const xpMap = {
            socialSuccess: 5,
            socialFailure: -2,
            conflictWins: 10,
            conflictLosses: -5,
            explorationSuccess: 8,
            helpingOthers: 7,
            beingHelped: 3,
            betrayals: -10,
        };
        this.totalXP += (xpMap[type] || 0) * intensity;

        // Check for trait evolution
        this.evolveTraits();
    }

    /**
     * Evolve traits based on accumulated experiences
     */
    evolveTraits() {
        const changes = [];

        // Chattiness evolution
        const socialBalance = this.experiences.socialSuccess - this.experiences.socialFailure;
        if (Math.abs(socialBalance) >= 5) {
            const delta = socialBalance > 0 ? 0.05 : -0.05;
            const oldVal = this.currentPersonality.chattiness || 0.5;
            this.currentPersonality.chattiness = Math.max(0.1, Math.min(0.9, oldVal + delta));
            if (Math.abs(delta) > 0) {
                changes.push({ trait: 'chattiness', from: oldVal, to: this.currentPersonality.chattiness, reason: socialBalance > 0 ? 'social success' : 'social rejection' });
            }
            // Reset counter after evolution
            this.experiences.socialSuccess = Math.max(0, this.experiences.socialSuccess - 3);
            this.experiences.socialFailure = Math.max(0, this.experiences.socialFailure - 3);
        }

        // Anger threshold evolution
        const conflictBalance = this.experiences.conflictWins - this.experiences.conflictLosses;
        if (Math.abs(conflictBalance) >= 3) {
            const delta = conflictBalance > 0 ? -0.05 : 0.05; // Wins = lower threshold (more confident)
            const oldVal = this.currentPersonality.angerThreshold || 0.5;
            this.currentPersonality.angerThreshold = Math.max(0.2, Math.min(0.9, oldVal + delta));
            if (Math.abs(delta) > 0) {
                changes.push({ trait: 'angerThreshold', from: oldVal, to: this.currentPersonality.angerThreshold, reason: conflictBalance > 0 ? 'stood ground' : 'was dominated' });
            }
            this.experiences.conflictWins = Math.max(0, this.experiences.conflictWins - 2);
            this.experiences.conflictLosses = Math.max(0, this.experiences.conflictLosses - 2);
        }

        // Emotional volatility evolution
        const trustBalance = this.experiences.beingHelped - this.experiences.betrayals;
        if (Math.abs(trustBalance) >= 3) {
            const delta = trustBalance > 0 ? -0.03 : 0.05; // Trust = more stable, betrayal = more volatile
            const oldVal = this.currentPersonality.emotionalVolatility || 0.5;
            this.currentPersonality.emotionalVolatility = Math.max(0.2, Math.min(0.9, oldVal + delta));
            if (Math.abs(delta) > 0) {
                changes.push({ trait: 'emotionalVolatility', from: oldVal, to: this.currentPersonality.emotionalVolatility, reason: trustBalance > 0 ? 'trust built' : 'betrayed' });
            }
            this.experiences.beingHelped = Math.max(0, this.experiences.beingHelped - 2);
            this.experiences.betrayals = Math.max(0, this.experiences.betrayals - 2);
        }

        // Record changes
        if (changes.length > 0) {
            this.traitHistory.push({
                timestamp: Date.now(),
                changes
            });
        }

        return changes;
    }

    /**
     * Get current evolved personality
     */
    getPersonality() {
        return this.currentPersonality;
    }

    /**
     * Get evolution summary
     */
    getSummary() {
        return {
            xp: this.totalXP,
            level: Math.floor(this.totalXP / 100),
            experiences: this.experiences,
            traitChanges: this.traitHistory.length,
            currentTraits: {
                chattiness: this.currentPersonality.chattiness?.toFixed(2),
                angerThreshold: this.currentPersonality.angerThreshold?.toFixed(2),
                emotionalVolatility: this.currentPersonality.emotionalVolatility?.toFixed(2),
            }
        };
    }

    toJSON() {
        return {
            basePersonality: this.basePersonality,
            currentPersonality: this.currentPersonality,
            experiences: this.experiences,
            traitHistory: this.traitHistory,
            totalXP: this.totalXP
        };
    }

    static fromJSON(data) {
        const te = new TraitEvolution(data.basePersonality);
        te.currentPersonality = data.currentPersonality;
        te.experiences = data.experiences;
        te.traitHistory = data.traitHistory || [];
        te.totalXP = data.totalXP || 0;
        return te;
    }
}

class RelationshipManager {
    constructor(botName, personality = {}) {
        this.botName = botName;
        this.relationships = new Map();
        this.traitEvolution = new TraitEvolution(personality);
        this.savePath = `./bots/${botName}/relationships.json`;

        // Social learning - observe other bots
        this.observations = [];
        this.maxObservations = 20;

        // Load existing data
        this.load();
    }

    /**
     * Get or create relationship with an entity
     */
    getRelationship(targetName, isBot = false) {
        if (!this.relationships.has(targetName)) {
            this.relationships.set(targetName, new Relationship(targetName, isBot));
        }
        return this.relationships.get(targetName);
    }

    /**
     * Record an interaction with someone
     */
    recordInteraction(targetName, type, details = {}, isBot = false) {
        const rel = this.getRelationship(targetName, isBot);
        rel.recordInteraction(type, details);

        // Send relationship update to Cerebro UI
        try {
            sendRelationshipUpdate(this.botName, targetName, {
                trust: rel.trust,
                respect: rel.respect,
                familiarity: rel.fondness,
                affection: rel.fondness,
                type: rel.type,
                interactionCount: rel.totalInteractions
            });
        } catch (e) {
            // Ignore if not connected
        }

        // Map interaction types to experiences
        const experienceMap = {
            'goodConversation': 'socialSuccess',
            'thanked': 'socialSuccess',
            'complimented': 'socialSuccess',
            'laughedTogether': 'socialSuccess',
            'ignored': 'socialFailure',
            'dismissed': 'socialFailure',
            'insulted': 'conflictLosses',
            'mocked': 'conflictLosses',
            'defended': 'conflictWins',
            'helped': 'helpingOthers',
            'gifted': 'helpingOthers',
            'betrayed': 'betrayals',
        };

        if (experienceMap[type]) {
            this.traitEvolution.recordExperience(experienceMap[type]);
        }

        // Auto-save periodically
        if (rel.totalInteractions % 5 === 0) {
            this.save();
        }

        return rel;
    }

    /**
     * Analyze a message to determine interaction type
     */
    analyzeMessage(sender, message, wasResponsePositive = null) {
        const msgLower = message.toLowerCase();
        const botLower = this.botName.toLowerCase();

        // Detect interaction type from message content
        if (msgLower.includes('thank') || msgLower.includes('thanks')) {
            return 'thanked';
        }
        if (msgLower.includes('good job') || msgLower.includes('nice') || msgLower.includes('awesome')) {
            return 'complimented';
        }
        if (msgLower.includes('stupid') || msgLower.includes('idiot') || msgLower.includes('useless')) {
            return 'insulted';
        }
        if (msgLower.includes('shut up') || msgLower.includes('be quiet')) {
            return 'dismissed';
        }
        if (msgLower.includes('help') && !msgLower.includes('?')) {
            return 'collaborated';
        }
        if (msgLower.includes('lol') || msgLower.includes('haha') || msgLower.includes('lmao')) {
            return 'laughedTogether';
        }
        if (msgLower.includes('?')) {
            return 'chatted';
        }

        return 'chatted';
    }

    /**
     * Observe another bot's behavior for social learning
     */
    observeBehavior(botName, behavior, outcome) {
        this.observations.push({
            bot: botName,
            behavior,
            outcome, // 'positive', 'negative', 'neutral'
            timestamp: Date.now()
        });

        if (this.observations.length > this.maxObservations) {
            this.observations.shift();
        }

        // Learn from observations
        this.learnFromObservations();
    }

    /**
     * Social learning - adjust behavior based on observed outcomes
     */
    learnFromObservations() {
        // Count successful behaviors
        const behaviorOutcomes = {};
        for (const obs of this.observations) {
            if (!behaviorOutcomes[obs.behavior]) {
                behaviorOutcomes[obs.behavior] = { positive: 0, negative: 0 };
            }
            if (obs.outcome === 'positive') {
                behaviorOutcomes[obs.behavior].positive++;
            } else if (obs.outcome === 'negative') {
                behaviorOutcomes[obs.behavior].negative++;
            }
        }

        // If we see a behavior consistently succeeding, we might adopt it
        for (const [behavior, outcomes] of Object.entries(behaviorOutcomes)) {
            if (outcomes.positive >= 3 && outcomes.positive > outcomes.negative * 2) {
                // This behavior works well - could influence our traits
                if (behavior === 'chatty' && this.traitEvolution.currentPersonality.chattiness < 0.7) {
                    this.traitEvolution.recordExperience('socialSuccess', 0.5);
                }
            }
        }
    }

    /**
     * Get relationship context for cognitive engine
     */
    getRelationshipContext(targetName) {
        const rel = this.relationships.get(targetName);
        if (!rel) return null;

        return {
            ...rel.getSummary(),
            shouldTrust: rel.trust > 0.2,
            shouldBeWary: rel.trust < -0.2,
            isLiked: rel.fondness > 0.3,
            isDisliked: rel.fondness < -0.3,
        };
    }

    /**
     * Get all relationships summary
     */
    getAllRelationships() {
        const summary = {};
        for (const [name, rel] of this.relationships) {
            summary[name] = rel.getSummary();
        }
        return summary;
    }

    /**
     * Get evolved personality
     */
    getEvolvedPersonality() {
        return this.traitEvolution.getPersonality();
    }

    /**
     * Get evolution stats
     */
    getEvolutionStats() {
        return this.traitEvolution.getSummary();
    }

    /**
     * Save to disk
     */
    save() {
        try {
            const dir = path.dirname(this.savePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data = {
                botName: this.botName,
                relationships: Object.fromEntries(
                    Array.from(this.relationships.entries()).map(([k, v]) => [k, v.toJSON()])
                ),
                traitEvolution: this.traitEvolution.toJSON(),
                observations: this.observations,
                savedAt: Date.now()
            };

            fs.writeFileSync(this.savePath, JSON.stringify(data, null, 2));
            console.log(`[${this.botName}] Saved relationships and evolution data`);
        } catch (err) {
            console.error(`[${this.botName}] Failed to save relationships:`, err.message);
        }
    }

    /**
     * Load from disk
     */
    load() {
        try {
            if (fs.existsSync(this.savePath)) {
                const data = JSON.parse(fs.readFileSync(this.savePath, 'utf8'));

                // Restore relationships
                for (const [name, relData] of Object.entries(data.relationships || {})) {
                    this.relationships.set(name, Relationship.fromJSON(relData));
                }

                // Restore trait evolution
                if (data.traitEvolution) {
                    this.traitEvolution = TraitEvolution.fromJSON(data.traitEvolution);
                }

                // Restore observations
                this.observations = data.observations || [];

                console.log(`[${this.botName}] Loaded ${this.relationships.size} relationships, XP: ${this.traitEvolution.totalXP}`);
            }
        } catch (err) {
            console.error(`[${this.botName}] Failed to load relationships:`, err.message);
        }
    }

    /**
     * Apply relationship decay (call periodically)
     */
    decayAll(hours = 1) {
        for (const rel of this.relationships.values()) {
            rel.decay(hours);
        }
    }
}

export { RelationshipManager, Relationship, TraitEvolution };
export default RelationshipManager;
