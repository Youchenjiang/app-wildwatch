import type { Brain } from "./brain";
import type { SpeciesParams, Vec2 } from "./types";

/** An individual NPC. Brain weights are the evolvable genome. */
export class Entity {
    id: number;
    generation = 0;
    age = 0;
    energy: number;
    angle: number;
    alive = true;
    foodEaten = 0;
    /** Lineage: [direct parent id, that parent's own parent id (or itself)]. */
    parentIds: readonly [number, number] | null = null;

    constructor(
        readonly species: SpeciesParams,
        readonly pos: Vec2,
        angle: number,
        readonly brain: Brain,
        id: number,
        energy: number,
    ) {
        this.angle = angle;
        this.id = id;
        this.energy = energy;
    }
}