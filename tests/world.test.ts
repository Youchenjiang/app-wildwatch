import { describe, expect, it } from "vitest";
import { DEFAULT_BRAIN_SPEC, World, type WorldConfig } from "../src/sim/world";

function makeConfig(seed = 42, overrides: Partial<WorldConfig> = {}): WorldConfig {
    return {
        width: 120,
        height: 120,
        seed,
        herbivoreCount: 30,
        carnivoreCount: 8,
        plantCount: 150,
        plantRegrowPerTick: 3,
        plantEnergy: 18,
        maxPlants: 400,
        turnLength: 50,
        populationCap: 300,
        mutationRate: 0.05,
        mutationSigma: 0.3,
        brainSpec: DEFAULT_BRAIN_SPEC,
        ...overrides,
    };
}

describe("World", () => {
    it("is fully deterministic for a fixed seed", () => {
        const a = new World(makeConfig(123));
        const b = new World(makeConfig(123));
        for (let i = 0; i < 400; i++) {
            a.tickStep();
            b.tickStep();
        }
        expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
        expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
    });

    it("keeps every entity inside world bounds", () => {
        const world = new World(makeConfig(7));
        for (let i = 0; i < 600; i++) world.tickStep();
        for (const e of world.entities) {
            expect(e.pos.x).toBeGreaterThanOrEqual(0);
            expect(e.pos.x).toBeLessThanOrEqual(world.config.width);
            expect(e.pos.y).toBeGreaterThanOrEqual(0);
            expect(e.pos.y).toBeLessThanOrEqual(world.config.height);
        }
    });

    it("records one snapshot per turnLength ticks", () => {
        const world = new World(makeConfig(1));
        for (let i = 0; i < world.config.turnLength * 3; i++) world.tickStep();
        expect(world.records).toHaveLength(3);
        expect(world.records[0]?.tick).toBe(world.config.turnLength);
    });

    it("never produces NaN or infinite energies", () => {
        const world = new World(makeConfig(99));
        for (let i = 0; i < 800; i++) world.tickStep();
        for (const e of world.entities) {
            expect(Number.isFinite(e.energy)).toBe(true);
        }
        for (const record of world.records) {
            expect(Number.isFinite(record.avgEnergy.herbivore)).toBe(true);
            expect(Number.isFinite(record.avgEnergy.carnivore)).toBe(true);
        }
    });

    it("records fitness statistics in snapshots", () => {
        const world = new World(makeConfig(21));
        for (let i = 0; i < 300; i++) world.tickStep();
        for (const record of world.records) {
            expect(Number.isFinite(record.avgFitness.herbivore)).toBe(true);
            expect(record.maxFitness.carnivore).toBeGreaterThanOrEqual(0);
        }
    });

    it("reproduces: births are recorded", () => {
        // No carnivores: herbivores should reproduce early and often.
        const world = new World(makeConfig(5, { carnivoreCount: 0 }));
        for (let i = 0; i < 300; i++) world.tickStep();
        const totalBirths = world.records.reduce((sum, r) => sum + r.births.herbivore, 0);
        expect(totalBirths).toBeGreaterThan(0);
    });
});