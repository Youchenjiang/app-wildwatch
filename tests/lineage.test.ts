import { describe, expect, it } from "vitest";
import { MAX_ANCESTRY_DEPTH, createLineage } from "../src/sim/lineage";
import { World, type WorldConfig } from "../src/sim/world";
import { grasslandEra, type EraConfig } from "../src/sim/era";

describe("lineage", () => {
    it("reports a parent as one generation and a grandparent as two", () => {
        const lin = createLineage();
        lin.add(1, null);
        lin.add(2, [1, 1]);
        lin.add(3, [2, 2]);

        expect(lin.depthOf(1, 2)).toBe(1);
        expect(lin.depthOf(1, 3)).toBe(2);
        expect(lin.depthOf(2, 3)).toBe(1);
    });

    it("treats both parents of a sexual spawn as one generation", () => {
        const lin = createLineage();
        lin.add(10, null);
        lin.add(11, null);
        lin.add(12, [10, 11]);

        expect(lin.depthOf(10, 12)).toBe(1);
        expect(lin.depthOf(11, 12)).toBe(1);
    });

    it("reports the shallowest relationship when several paths reach it", () => {
        // 3 is 4's parent, but 3 is also 4's great-great-grandparent down the
        // other branch, because 1 and 2 were inbred. The closest link wins.
        const lin = createLineage();
        lin.add(1, [2, 2]);
        lin.add(2, [3, 3]);
        lin.add(4, [1, 3]);

        expect(lin.depthOf(3, 4)).toBe(1);
        expect(lin.depthOf(2, 4)).toBe(2);
    });

    it("collapses a clone's duplicated parent into one ancestor", () => {
        const lin = createLineage();
        lin.add(1, null);
        lin.add(2, [1, 1]);
        expect(lin.depthOf(1, 2)).toBe(1);
        expect(lin.size()).toBe(1);
    });

    it("returns null for unrelated, self and unknown ids", () => {
        const lin = createLineage();
        lin.add(1, null);
        lin.add(2, [1, 1]);
        lin.add(9, null);

        expect(lin.depthOf(9, 2)).toBeNull();
        expect(lin.depthOf(1, 1)).toBeNull();
        expect(lin.depthOf(1, 999)).toBeNull();
        expect(lin.depthOf(999, 2)).toBeNull();
    });

    it("ignores founders, which have no ancestry to record", () => {
        const lin = createLineage();
        lin.add(1, null);
        expect(lin.size()).toBe(0);
    });

    it("stops at the depth cap instead of walking forever", () => {
        const lin = createLineage();
        lin.add(1, null);
        for (let i = 2; i <= 40; i++) lin.add(i, [i - 1, i - 1]);

        expect(lin.depthOf(1, 33)).toBe(MAX_ANCESTRY_DEPTH);
        expect(lin.depthOf(1, 40)).toBeNull();
    });

    it("survives a cyclic chain without hanging", () => {
        const lin = createLineage();
        lin.add(1, [2, 2]);
        lin.add(2, [1, 1]);
        expect(lin.depthOf(3, 1)).toBeNull();
        expect(lin.depthOf(2, 1)).toBe(1);
    });
});

/** A cramped world where a corpse is always within reach. */
function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
    return {
        width: 30,
        height: 30,
        seed: 7,
        herbivoreCount: 0,
        carnivoreCount: 1,
        plantCount: 0,
        plantRegrowPerTick: 0,
        plantEnergy: 20,
        maxPlants: 1,
        turnLength: 1,
        populationCap: 500,
        mateRange: 3,
        mutationRate: 0,
        mutationSigma: 0,
        brainSpec: { inputSize: 11, hiddenSize: 2, outputSize: 2 },
        memoryCapacity: 4,
        mealLogCapacity: 6,
        lifeGridCellsize: 6,
        lifeGridDecay: 0,
        lifeGridCap: 20,
        ...overrides,
    };
}

/**
 * Grassland, but with a carnivore whose reach is wide enough that a placed
 * corpse is always inside it. The animal still moves between the corpse's
 * position and its bite, and at speed 1.7 that easily exceeds the real
 * eatRadius — this keeps the test about kinship rather than about proximity.
 */
function reachingEra(): EraConfig {
    return {
        ...grasslandEra,
        plants: { ...grasslandEra.plants, regrowPerTick: 0 },
        carnivore: { ...grasslandEra.carnivore, eatRadius: 12 },
    };
}

describe("kin feeding", () => {
    it("flags a predator eating its own child's corpse", () => {
        const world = new World(makeConfig({ era: reachingEra() }));
        const parent = world.entities[0];
        // Enough energy to pay for offspring and still survive the tick.
        parent.energy = 500;
        // No mate, so this is the asexual path: the child's parent is `parent`.
        world["reproduce"](parent);

        const child = world.entities[1];
        expect(child.parentIds![0]).toBe(parent.id);

        world["kill"](child, "test");
        const corpse = world.carrions[0];
        corpse.x = parent.pos.x;
        corpse.y = parent.pos.y;
        world.tickStep();

        const meal = parent.meals.recent(3).find((m) => m.source === "carrion")!;
        expect(meal.kin).toBe(true);
        expect(meal.kinGeneration).toBe(1);
        expect(meal.victimId).toBe(child.id);
        expect(parent.meals.kinCount()).toBe(1);
        expect(world.kinMealsEaten).toBe(1);
        expect(world.carrionMealsEaten).toBe(1);
    });

    it("does not flag an unrelated corpse", () => {
        const world = new World(makeConfig({ carnivoreCount: 2, era: reachingEra() }));
        const [eater, other] = world.entities;

        world["kill"](other, "test");
        const corpse = world.carrions[0];
        corpse.x = eater.pos.x;
        corpse.y = eater.pos.y;
        world.tickStep();

        const meal = eater.meals.recent(3).find((m) => m.source === "carrion")!;
        expect(meal.kin).toBeUndefined();
        expect(eater.meals.kinCount()).toBe(0);
        expect(world.kinMealsEaten).toBe(0);
        expect(world.carrionMealsEaten).toBe(1);
    });

    it("separates kin meals from the total corpse meals", () => {
        const world = new World(makeConfig({ carnivoreCount: 2, era: reachingEra() }));
        const [eater, other] = world.entities;
        eater.energy = 500;
        world["reproduce"](eater);
        const child = world.entities[2];

        // A carnivore only takes one corpse per tick, so feed them one at a
        // time: first an unrelated body, then one of the eater's own children.
        world["kill"](other, "test");
        const stranger = world.carrions[0];
        stranger.x = eater.pos.x;
        stranger.y = eater.pos.y;
        world.tickStep();

        world["kill"](child, "test");
        const kin = world.carrions.find((c) => c.alive)!;
        kin.x = eater.pos.x;
        kin.y = eater.pos.y;
        world.tickStep();

        expect(world.carrionMealsEaten).toBe(2);
        expect(world.kinMealsEaten).toBe(1);
    });

    it("exposes its lineage registry for future pedigree views", () => {
        const world = new World(makeConfig());
        expect(world.lineageSize).toBe(0);
        const parent = world.entities[0];
        parent.energy = 500;
        world["reproduce"](parent);
        expect(world.lineageSize).toBe(1);
    });
});
