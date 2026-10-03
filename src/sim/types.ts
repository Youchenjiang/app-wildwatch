import type { BrainSpec } from "./brain";

/** Simulation runs on a 2D plane; 3D is purely a visual layer on top. */
export interface Vec2 {
    x: number;
    y: number;
}

export type SpeciesKind = "herbivore" | "carnivore";

/** Serialized neural network weights suitable for JSON persistence. */
export interface SerializedBrainWeights {
    w1: number[];
    b1: number[];
    w2: number[];
    b2: number[];
}

/** Pre-evolved archetype seed for a species, tested across eons. */
export interface SacredSeed {
    species: SpeciesKind;
    fitness: number;
    spec: BrainSpec;
    weights: SerializedBrainWeights;
}

/** God's meta-policy hyper-parameters for ecosystem regulation. */
export interface GodPolicy {
    /** Prey population count below which bountiful rain is triggered. */
    rainPreyThreshold: number;
    /** Predator population count above which metabolic blight is triggered. */
    blightPredatorThreshold: number;
    /** Predator population count below which predator sanctuary is triggered. */
    sanctuaryPredatorThreshold?: number;
    /** Cooldown in ticks between god interventions. */
    interventionCooldown: number;
    /** Baseline tendency toward pack cohesion (0: solitary, 1: tight pack). */
    socialTendency: number;
}

/** God's persistent memory across generations, loaded by GitHub Pages. */
export interface GodMemory {
    version: string;
    updatedAt: string;
    eons: number;
    sacredSeeds: {
        herbivore: SacredSeed;
        carnivore: SacredSeed;
    };
    policy: GodPolicy;
}


/** Tuning parameters that define a species (later scenarios will vary these). */
export interface SpeciesParams {
    kind: SpeciesKind;
    name: string;
    /** Base color for the renderer (hex). */
    color: number;
    /** Base movement speed per tick (units). */
    speed: number;
    /** Max steering per tick (radians). */
    maxTurn: number;
    /** How far senses reach (units). */
    senseRange: number;
    /** Contact radius at which food/prey is eaten (units). */
    eatRadius: number;
    /** Energy consumed per unit of movement. */
    moveCost: number;
    /**
     * Biomechanical cost of turning: at full steer, movement energy is
     * multiplied by (1 + turnCost). Spinning in place is expensive, so
     * selection favors purposeful, straighter travel.
     */
    turnCost: number;
    /** Energy cap; used for normalization only. */
    maxEnergy: number;
    /** Reproduce once energy is at or above this threshold. */
    reproduceEnergy: number;
    /** Energy paid (split across the litter) to reproduce. */
    reproduceCost: number;
    /** Number of offspring per reproduction event. */
    litterSize: number;
    /** Lifespan in ticks. */
    maxAge: number;
    /** Energy granted per unit of food consumed. */
    foodEnergy: number;
}