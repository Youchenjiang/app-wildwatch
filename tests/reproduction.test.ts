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
    for (const entity of world.entities) {
        entity.pos.x = 15;
        entity.pos.y = 15;
        entity.energy = entity.species.maxEnergy;
    }
}

describe("reproduction mode", () => {
    it("never mates in asexual mode, even with a partner on top of it", () => {
        const world = new World(makeConfig("asexual"));
        stack(world);
        for (let i = 0; i < 400; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.sexualBirths).toBe(0);
        for (const entity of world.entities) {
            if (entity.parentIds === null) continue;
            // A clone records one parent in both slots.
            expect(entity.parentIds[0]).toBe(entity.parentIds[1]);
        }
    });

    it("mates in sexual mode when a partner is in reach", () => {
        const world = new World(makeConfig("sexual"));
        stack(world);
        for (let i = 0; i < 400; i++) world.tickStep();

        expect(world.sexualBirths).toBeGreaterThan(0);
        expect(world.asexualBirths).toBe(0);
        const child = world.entities.find(
            (entity) => entity.parentIds !== null && entity.parentIds[0] !== entity.parentIds[1],
        );
        expect(child).toBeDefined();
    });

    // A lone animal can never meet a partner, which is the only way to express
    // "no mate available" that wandering cannot undo: mateRange is a true
    // distance, so two animals a cell apart no longer count as near, but any
    // pair that drifts together over 600 ticks would eventually mate.
    it("never reproduces in sexual mode when no partner exists, and never clones", () => {
        const world = new World(makeConfig("sexual", { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        const alone = world.entities[0];
        expect(world.sexualBirths).toBe(0);
        expect(world.asexualBirths).toBe(0);
        expect(world.populationOf("herbivore")).toBe(1);
        // Waiting means holding the energy rather than spending it on a child.
        expect(alone.energy).toBeGreaterThanOrEqual(alone.species.reproduceEnergy);
        expect(alone.reproduceCooldown).toBe(0);
    });

    it("clones in asexual mode when no partner exists", () => {
        const world = new World(makeConfig("asexual", { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.sexualBirths).toBe(0);
        expect(world.populationOf("herbivore")).toBeGreaterThan(1);
    });

    it("treats an unset mode as asexual, which is what runs have always done", () => {
        const world = new World(makeConfig(undefined, { herbivoreCount: 1 }));
        for (let i = 0; i < 600; i++) world.tickStep();

        expect(world.asexualBirths).toBeGreaterThan(0);
        expect(world.sexualBirths).toBe(0);
    });

    it("keeps the two modes apart over a long run, not just a short one", () => {
        // The guarantee the UI leans on: a sexual run is sexual throughout, so
        // no display needs to distinguish the two.
        const sexual = new World(makeConfig("sexual", { herbivoreCount: 8, plantCount: 120, maxPlants: 120 }));
        const asexual = new World(makeConfig("asexual", { herbivoreCount: 8, plantCount: 120, maxPlants: 120 }));
        for (let i = 0; i < 2000; i++) {
            sexual.tickStep();
            asexual.tickStep();
        }

        expect(sexual.sexualBirths).toBeGreaterThan(0);
        expect(sexual.asexualBirths).toBe(0);
        expect(asexual.asexualBirths).toBeGreaterThan(0);
        expect(asexual.sexualBirths).toBe(0);
    });
});
