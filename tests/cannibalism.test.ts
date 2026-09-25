import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import type { Entity } from "../src/sim/entity";

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
        const a = world.entities[0]!;
        const b = world.entities[1]!;
        a.pos.x = b.pos.x = 15;
        a.pos.y = b.pos.y = 15;
        // Starve one well below any reasonable threshold.
        a.energy = 1;
        b.energy = 50;
        const before = world.entities.length;
        world.tickStep();
        // Neither should have been eaten — cannibalism is off.
        expect(world.entities.filter((e) => e.alive && e.species.kind === "carnivore").length).toBe(before);
    });

    it("starving carnivore senses same-species as prey when threshold > 0", () => {
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2 });
        const world = new World(config);
        // Run one tick so the spatial grid is populated.
        world.tickStep();
        const a = world.entities.find((e) => e.alive && e.species.kind === "carnivore")!;
        const b = world.entities.find((e) => e.alive && e.species.kind === "carnivore" && e !== a)!;
        // Place both on the same spot.
        a.pos.x = b.pos.x = 15;
        a.pos.y = b.pos.y = 15;
        a.energy = 1; // well below 0.15 * 100 = 15
        b.energy = 80;
        // Sync the grid so sense() can find entities at their new positions.
        (world as any).grid.clear();
        for (const e of world.entities) { if (e.alive) (world as any).grid.insert(e); }
        const sense = (world as any).sense.bind(world) as (e: Entity) => { dx: number; dy: number; dist: number } | null;
        const result = sense(a);
        expect(result).not.toBeNull();
    });

    it("well-fed carnivore does NOT sense same-species as prey", () => {
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2 });
        const world = new World(config);
        world.tickStep();
        const a = world.entities.find((e) => e.alive && e.species.kind === "carnivore")!;
        const b = world.entities.find((e) => e.alive && e.species.kind === "carnivore" && e !== a)!;
        a.pos.x = b.pos.x = 15;
        a.pos.y = b.pos.y = 15;
        a.energy = 80; // well above 0.15 * 100 = 15
        b.energy = 50;
        (world as any).grid.clear();
        for (const e of world.entities) { if (e.alive) (world as any).grid.insert(e); }
        const sense = (world as any).sense.bind(world) as (e: Entity) => { dx: number; dy: number; dist: number } | null;
        // No herbivores in the world, and a is not starving → nothing to sense.
        expect(sense(a)).toBeNull();
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
        const prey = world.entities[0]!;
        // Starve the prey so other carnivores will target it.
        prey.energy = 1;
        // Place all 4 on the same spot to guarantee overlap.
        for (const e of world.entities) {
            e.pos.x = 5;
            e.pos.y = 5;
        }
        const aliveBefore = world.entities.filter((e) => e.alive).length;
        // Run several ticks — with 4 carnivores in a 10×10 world the density
        // is high enough that at least one cannibalistic catch should land.
        for (let i = 0; i < 20; i++) world.tickStep();
        const aliveAfter = world.entities.filter((e) => e.alive && e.species.kind === "carnivore").length;
        expect(aliveAfter).toBeLessThan(aliveBefore);
    });

    it("cannibalismThreshold only triggers below the threshold, not above it", () => {
        const config = cannibalConfig({ seed: 11, carnivoreCount: 2 });
        const world = new World(config);
        world.tickStep();
        const a = world.entities.find((e) => e.alive && e.species.kind === "carnivore")!;
        const b = world.entities.find((e) => e.alive && e.species.kind === "carnivore" && e !== a)!;
        a.pos.x = b.pos.x = 15;
        a.pos.y = b.pos.y = 15;
        a.energy = 16; // just above 0.15 * 100 = 15 → NOT starving
        b.energy = 50;
        (world as any).grid.clear();
        for (const e of world.entities) { if (e.alive) (world as any).grid.insert(e); }
        const sense = (world as any).sense.bind(world) as (e: Entity) => { dx: number; dy: number; dist: number } | null;
        // At 16 > 15, cannibalism should NOT activate.
        expect(sense(a)).toBeNull();
        // Drop to 14 < 15 → cannibalism activates.
        a.energy = 14;
        expect(sense(a)).not.toBeNull();
    });

    it("does not read a below-zero energy dip as starvation while it is off", () => {
        // Energy dips slightly below zero before an animal dies. An ungated
        // `energy < threshold * maxEnergy` comparison read that dip as
        // starvation even at the default threshold of 0, which let a disabled
        // feature hunt its own kind and moved the balance baselines.
        const config = cannibalConfig({ seed: 7, carnivoreCount: 2, cannibalismThreshold: 0 });
        const world = new World(config);
        world.tickStep();
        const a = world.entities.find((e) => e.alive && e.species.kind === "carnivore")!;
        const b = world.entities.find((e) => e.alive && e.species.kind === "carnivore" && e !== a)!;
        a.pos.x = b.pos.x = 15;
        a.pos.y = b.pos.y = 15;
        a.energy = -0.1; // the dip, not a starvation state
        b.energy = 50;
        (world as any).grid.clear();
        for (const e of world.entities) { if (e.alive) (world as any).grid.insert(e); }
        const sense = (world as any).sense.bind(world) as (e: Entity) => { dx: number; dy: number; dist: number } | null;
        expect(sense(a)).toBeNull();
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
        for (let i = 0; i < 4000; i++) {
            world.tickStep();
            for (const e of world.entities) {
                kindById.set(e.id, e.species.kind);
                const prey = e.meals.counts().prey;
                const before = seenPrey.get(e) ?? 0;
                if (prey > before) {
                    hunts += prey - before;
                    const newest = e.meals.recent(1)[0];
                    if (
                        newest?.source === "prey" &&
                        newest.victimId !== undefined &&
                        kindById.get(newest.victimId) === e.species.kind
                    ) {
                        ownKind++;
                    }
                    seenPrey.set(e, prey);
                }
            }
        }
        expect(hunts, "the run never hunted, so this proves nothing").toBeGreaterThan(0);
        expect(ownKind, "a disabled feature hunted its own kind").toBe(0);
    }, 120000);
});
