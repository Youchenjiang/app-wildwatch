import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import type { Entity } from "../src/sim/entity";

interface WorldSenseAccessor {
    syncIndexes: () => void;
    sense: (entity: Entity) => { dx: number; dy: number; dist: number } | null;
}

function asSenseAccessor(world: World): WorldSenseAccessor {
    return world as unknown as WorldSenseAccessor;
}

function requireCarnivorePair(world: World): [Entity, Entity] {
    const carnivores = world.entities.filter((entity) => entity.alive && entity.species.kind === "carnivore");
    expect(carnivores.length).toBeGreaterThanOrEqual(2);
    const firstCarnivore = carnivores[0];
    const secondCarnivore = carnivores[1];
    if (!firstCarnivore || !secondCarnivore) {
        throw new Error("Expected at least two live carnivores");
    }
    return [firstCarnivore, secondCarnivore];
}

/** Create a minimal config with cannibalism enabled. */
function cannibalConfig(
    overrides: Partial<WorldConfig> & { seed: number } = { seed: 42 },
): WorldConfig {
    return {
        ...makeSeeding(overrides.seed),
        width: 30,
        height: 30,
        herbivoreCount: 0,
        carnivoreCount: 0,
        plantCount: 0,
        plantRegrowPerTick: 0,
        turnLength: 1,
        cannibalismThreshold: 0.15,
        ...overrides,
    };
}

describe("cannibalism", () => {
    it("disabled by default: carnivores ignore same-species prey", () => {
        const config: WorldConfig = {
            ...makeSeeding(1),
            width: 30,
            height: 30,
            herbivoreCount: 0,
            carnivoreCount: 2,
            plantCount: 0,
            plantRegrowPerTick: 0,
            turnLength: 1,
            // No cannibalismThreshold → defaults to 0 (disabled).
        };
        const world = new World(config);
        // Place both carnivores on the same spot so they are within eatRadius.
        const [firstHunter, secondHunter] = requireCarnivorePair(world);
        firstHunter.pos.x = secondHunter.pos.x = 15;
        firstHunter.pos.y = secondHunter.pos.y = 15;
        // Starve one well below any reasonable threshold.
        firstHunter.energy = 1;
        secondHunter.energy = 50;
        const before = world.entities.length;
        world.tickStep();
        // Neither should have been eaten — cannibalism is off.
        const remainingCarnivores = world.entities.filter(
            (entity) => entity.alive && entity.species.kind === "carnivore",
        );
        expect(remainingCarnivores).toHaveLength(before);
    });

    it("starving carnivore senses same-species as prey when threshold > 0", () => {
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2 });
        const world = new World(config);
        // Run one tick so the spatial grid is populated.
        world.tickStep();
        const [firstHunter, secondHunter] = requireCarnivorePair(world);
        // Place both on the same spot.
        firstHunter.pos.x = secondHunter.pos.x = 15;
        firstHunter.pos.y = secondHunter.pos.y = 15;
        firstHunter.energy = 1; // well below 0.15 * 100 = 15
        secondHunter.energy = 80;
        // Sync the grid so sense() can find entities at their new positions.
        const internalWorld = asSenseAccessor(world);
        internalWorld.syncIndexes();
        const result = internalWorld.sense(firstHunter);
        expect(result).not.toBeNull();
    });

    it("well-fed carnivore does NOT sense same-species as prey", () => {
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2 });
        const world = new World(config);
        world.tickStep();
        const [firstHunter, secondHunter] = requireCarnivorePair(world);
        firstHunter.pos.x = secondHunter.pos.x = 15;
        firstHunter.pos.y = secondHunter.pos.y = 15;
        firstHunter.energy = 80; // well above 0.15 * 100 = 15
        secondHunter.energy = 50;
        const internalWorld = asSenseAccessor(world);
        internalWorld.syncIndexes();
        // No herbivores in the world, and firstHunter is not starving → nothing to sense.
        expect(internalWorld.sense(firstHunter)).toBeNull();
    });

    it("starving carnivore eats a same-species neighbour within eatRadius", () => {
        // Use a tiny world to push carnivore density high (so catch chance is
        // not negligible), place them together, and run several ticks.
        const config: WorldConfig = {
            ...makeSeeding(3),
            width: 10,
            height: 10,
            herbivoreCount: 0,
            carnivoreCount: 4,
            plantCount: 0,
            plantRegrowPerTick: 0,
            turnLength: 1,
            cannibalismThreshold: 0.15,
        };
        const world = new World(config);
        const prey = world.entities[0];
        expect(prey).toBeDefined();
        if (!prey) {
            throw new Error("Expected prey entity");
        }
        // Starve the prey so other carnivores will target it.
        prey.energy = 1;
        // Place all 4 on the same spot to guarantee overlap.
        for (const entity of world.entities) {
            entity.pos.x = 5;
            entity.pos.y = 5;
        }
        const aliveBefore = world.entities.filter((entity) => entity.alive).length;
        // Run several ticks — with 4 carnivores in a 10×10 world the density
        // is high enough that at least one cannibalistic catch should land.
        for (let tickIndex = 0; tickIndex < 20; tickIndex++) {
            world.tickStep();
        }
        const aliveAfter = world.entities.filter(
            (entity) => entity.alive && entity.species.kind === "carnivore",
        ).length;
        expect(aliveAfter).toBeLessThan(aliveBefore);
    });

    it("cannibalismThreshold only triggers below the threshold, not above it", () => {
        const config = cannibalConfig({ seed: 11, carnivoreCount: 2 });
        const world = new World(config);
        world.tickStep();
        const [firstHunter, secondHunter] = requireCarnivorePair(world);
        firstHunter.pos.x = secondHunter.pos.x = 15;
        firstHunter.pos.y = secondHunter.pos.y = 15;
        firstHunter.energy = 16; // just above 0.15 * 100 = 15 → NOT starving
        secondHunter.energy = 50;
        const internalWorld = asSenseAccessor(world);
        internalWorld.syncIndexes();
        // At 16 > 15, cannibalism should NOT activate.
        expect(internalWorld.sense(firstHunter)).toBeNull();
        // Drop to 14 < 15 → cannibalism activates.
        firstHunter.energy = 14;
        expect(internalWorld.sense(firstHunter)).not.toBeNull();
    });

    it("does not read a below-zero energy dip as starvation while it is off", () => {
        // The threshold is an enable switch and is checked as one, rather than
        // by comparing energy against it alone. Energy can no longer go below
        // zero (a charge stops at zero), so this pins the gate itself: a value
        // below zero must never enable the feature, even if one appears again.
        // That is the shape of the bug that shipped — the old comparison read
        // the dip as starvation, so a disabled feature hunted its own kind and
        // moved the balance baselines with it.
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2, cannibalismThreshold: 0 });
        const world = new World(config);
        world.tickStep();
        const [firstHunter, secondHunter] = requireCarnivorePair(world);
        firstHunter.pos.x = secondHunter.pos.x = 15;
        firstHunter.pos.y = secondHunter.pos.y = 15;
        firstHunter.energy = -0.1; // the dip, not a starvation state
        secondHunter.energy = 50;
        const internalWorld = asSenseAccessor(world);
        internalWorld.syncIndexes();
        expect(internalWorld.sense(firstHunter)).toBeNull();
    });

    it("files no same-kind hunt across a long run while it is off", () => {
        // The direct long-run guard: a full meadow run with the feature off may
        // never record a `prey` meal whose victim was the eater's own kind.
        // (The balance probe is the coarse version of this — its grassland run
        // is pinned at h=53 c=50 — but this one names the mechanism.)
        const world = new World(makeSeeding(20260907));
        const kindById = new Map<number, string>();
        const seenPrey = new Map<Entity, number>();
        let hunts = 0;
        let ownKind = 0;
        for (let tickIndex = 0; tickIndex < 4000; tickIndex++) {
            world.tickStep();
            for (const entity of world.entities) {
                kindById.set(entity.id, entity.species.kind);
                const preyCount = entity.meals.counts().prey;
                const beforeCount = seenPrey.get(entity) ?? 0;
                if (preyCount > beforeCount) {
                    hunts += preyCount - beforeCount;
                    const newest = entity.meals.recent(1)[0];
                    if (
                        newest?.source === "prey" &&
                        newest.victimId !== undefined &&
                        kindById.get(newest.victimId) === entity.species.kind
                    ) {
                        ownKind++;
                    }
                    seenPrey.set(entity, preyCount);
                }
            }
        }
        expect(hunts, "the run never hunted, so this proves nothing").toBeGreaterThan(0);
        expect(ownKind, "a disabled feature hunted its own kind").toBe(0);
    }, 120000);
});
