/**
 * Ancestry for every entity ever spawned — living or dead.
 *
 * The simulation keeps only the living, so a dead animal's parents vanish with
 * it and a chain cannot be walked back through the population. This registry
 * keeps the links forever, which is what makes questions like "is this corpse
 * one of my own relatives?" answerable at all, and is the groundwork the
 * README's pedigree tree will need.
 *
 * It is a record only: nothing here feeds back into a decision, so it cannot
 * change a run's outcome. Cost is one small entry per entity ever spawned
 * (parents are held as plain numbers, not per-entity arrays), which for a long
 * run is a few megabytes.
 */

/** Generations between an ancestor and a descendant: 1 = parent, 2 =
 * grandparent, and so on. Deeper than this is treated as unrelated, so a
 * pathological or corrupted chain can never hang the sim. */
export const MAX_ANCESTRY_DEPTH = 32;

/**
 * How one animal is related to another by descent.
 *
 * `side` is stated from the first animal's point of view: "ancestor" means the
 * other animal is further *up* the tree (a forebear), "descendant" means it is
 * further *down* (an offspring). `generations` is the distance separating them,
 * so 1 is a parent or a child.
 */
export interface KinRelation {
    side: "ancestor" | "descendant";
    generations: number;
}

export interface Lineage {
    /** Record an entity's parents. Founders pass null and record nothing. */
    add(id: number, parentIds: readonly number[] | null): void;
    /**
     * How many generations separate an ancestor from a descendant, or null
     * when they are unrelated (or the chain is deeper than the cap).
     */
    depthOf(ancestorId: number, descendantId: number): number | null;
    /**
     * How `otherId` is related to `id` by descent, or null when unrelated.
     *
     * Descent runs both ways and the two directions behave very differently in
     * this world, so a caller must not assume which one it is looking at: a
     * parent that dies leaves a corpse its offspring may still be standing
     * beside, while an offspring that dies has usually wandered away from its
     * parent by then. Answering both directions in one place keeps that
     * decision here instead of making every caller guess a direction and
     * silently miss half the cases.
     */
    kinTo(id: number, otherId: number): KinRelation | null;
    /** How many entities have recorded ancestry. */
    size(): number;
}

export function createLineage(): Lineage {
    // Two maps rather than one map of arrays: every entity with parents has a
    // first parent, while a second is dropped when it duplicates the first
    // (an asexual clone records its single parent twice).
    const primary = new Map<number, number>();
    const secondary = new Map<number, number>();

    const parentsOf = (id: number): number[] => {
        const first = primary.get(id);
        if (first === undefined) return [];
        const second = secondary.get(id);
        return second === undefined ? [first] : [first, second];
    };

    /**
     * Generations from an ancestor down to a descendant, or null when the
     * ancestor is not above it. Breadth-first, so the shallowest relationship
     * wins: a parent is always reported as 1 generation even if some other
     * path could also reach it further up the tree.
     */
    const walk = (ancestorId: number, descendantId: number): number | null => {
        if (ancestorId === descendantId) return null;
        let frontier: number[] = parentsOf(descendantId);
        const seen = new Set<number>(frontier);
        for (let depth = 1; depth <= MAX_ANCESTRY_DEPTH && frontier.length > 0; depth++) {
            const next: number[] = [];
            for (const id of frontier) {
                if (id === ancestorId) return depth;
                for (const parent of parentsOf(id)) {
                    if (seen.has(parent)) continue;
                    seen.add(parent);
                    next.push(parent);
                }
            }
            frontier = next;
        }
        return null;
    };

    return {
        add(id: number, parentIds: readonly number[] | null): void {
            if (!parentIds || parentIds.length === 0) return;
            primary.set(id, parentIds[0]);
            // A clone records its one parent twice: that is one ancestor, not two.
            if (parentIds.length > 1 && parentIds[1] !== parentIds[0]) {
                secondary.set(id, parentIds[1]);
            }
        },

        depthOf(ancestorId: number, descendantId: number): number | null {
            return walk(ancestorId, descendantId);
        },

        kinTo(id: number, otherId: number): KinRelation | null {
            if (id === otherId) return null;
            // Down first, then up: they cannot both hold, since a chain of
            // parents is acyclic in practice and `seen` bounds it if it is not.
            const down = walk(id, otherId);
            if (down !== null) return { side: "descendant", generations: down };
            const up = walk(otherId, id);
            return up === null ? null : { side: "ancestor", generations: up };
        },

        size(): number {
            return primary.size;
        },
    };
}
