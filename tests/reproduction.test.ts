import { describe, expect, it } from "vitest";
import { DEFAULT_BRAIN_SPEC, World, type ReproductionMode, type WorldConfig } from "../src/sim/world";

/** Two herbivores and nothing else: every birth is attributable to them. */
function makeConfig(
    reproduction: ReproductionMode | undefined,
    overrides: Partial<WorldConfig> = {},
): WorldConfig {
    return {
        width: 30,
        height: 30,
        seed: 3,
        herbivoreCount: 2,
        carnivoreCount: 0,
        plantCount: 40,
        plantRegrowPerTick: 4,
        plantEnergy: 20,
        maxPlants: 40,
        turnLength: 10,
        populationCap: 50,
        mateRange: 6,
        mutationRate: 0,
        mutationSigma: 0,
        brainSpec: { inputSize: 11, hiddenSize: 2, outputSize: 2 },
        memoryCapacity: 4,
        mealLogCapacity: 4,
        lifeGridCellsize: 6,
        lifeGridDecay: 0,
        lifeGridCap: 20,
        reproduction,
        ...overrides,
    };
}

/** Stack the starting animals on one cell at breeding energy. */
function stack(world: World): void {
    for (const e of world.entities) {
        e.pos.x = 15;
        e.pos.y = 15;
        e.energy = e.species.maxEnergy;
    }
}

describe("reproduction mode", () => {
    it("never mates in asexual mode, even with a partner on top of it", () => {
        const world = new World(makeConfig("asexual"));
        stack(world);
        for (let i = 0; i < 400; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.sexualBirths).toBe(0);
        for (const e of world.entities) {
            if (e.parentIds === null) continue;
            // A clone records one parent in both slots.
            expect(e.parentIds[0]).toBe(e.parentIds[1]);
        }
    });

    it("mates in sexual mode when a partner is in reach", () => {
        const world = new World(makeConfig("sexual"));
        stack(world);
        for (let i = 0; i < 400; i++) world.tickStep();

        expect(world.sexualBirths).toBeGreaterThan(0);
        expect(world.asexualBirths).toBe(0);
        const child = world.entities.find(
            (e) => e.parentIds !== null && e.parentIds[0] !== e.parentIds[1],
        );
        expect(child).toBeDefined();
    });

    // A lone animal can never meet a partner, which is the only way to express
    // "no mate available" that cannot be undone by wandering: mateRange is not
    // a distance check, it picks which grid cells to scan, so two animals in
    // one cell find each other even at range 0.
    it("waits rather than cloning in sexual mode when no partner exists", () => {
        const world = new World(makeConfig("sexual", { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        const alone = world.entities[0];
        expect(world.sexualBirths).toBe(0);
        expect(world.asexualBirths).toBe(0);
        expect(world.populationOf("herbivore")).toBe(1);
        // Waiting means holding the energy rather than spending it on a clone.
        expect(alone.energy).toBeGreaterThanOrEqual(alone.species.reproduceEnergy);
        expect(alone.reproduceCooldown).toBe(0);
    });

    // A mixed population is free to mate once cloning has produced a second
    // animal, so the claim here is only that the lone founder's own line
    // continues without a partner — which is what the fallback is for.
    it("falls back to cloning in mixed mode when no partner exists", () => {
        const world = new World(makeConfig("mixed", { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.populationOf("herbivore")).toBeGreaterThan(1);
    });

    it("treats an unset mode as mixed, so existing runs are unchanged", () => {
        const world = new World(makeConfig(undefined, { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.populationOf("herbivore")).toBeGreaterThan(1);
    });

    it("reports the birth split in the turn records", () => {
        const world = new World(makeConfig("asexual"));
        stack(world);
        for (let i = 0; i < 400; i++) world.tickStep();

        const last = world.records[world.records.length - 1];
        expect(last.sexualBirths).toBe(0);
        expect(last.asexualBirths).toBe(world.asexualBirths);
    });
});
