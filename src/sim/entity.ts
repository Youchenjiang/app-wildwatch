import type { Brain } from "./brain";
import type { SpeciesParams, Vec2 } from "./types";
import type { Memory } from "./memory";

/** An individual NPC. Brain weights are the evolvable genome. */
export class Entity {
    id: number;
    generation = 0;
    age = 0;
    energy: number;
    angle: number;
    alive = true;
    foodEaten = 0;
    /** Lifetime food energy gained — the fitness metric natural selection acts on. */
    fitness = 0;
    /** Ticks before this entity may reproduce again. */
    reproduceCooldown = 0;
    /** Lineage: [direct parent id, that parent's own parent id (or itself)]. */
    parentIds: readonly [number, number] | null = null;

    /** Episodic memory: rewarding events bias later behavior within a lifetime. */
    memory: Memory;

    /** The evolvable genome; mutable so experiments may inject genomes. */
    brain: Brain;

    constructor(
        readonly species: SpeciesParams,
        readonly pos: Vec2,
        angle: number,
        brain: Brain,
        id: number,
        energy: number,
        memory: Memory,
    ) {
        this.brain = brain;
        this.angle = angle;
        this.id = id;
        this.energy = energy;
        this.memory = memory;
    }
}