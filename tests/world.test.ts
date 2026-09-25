import { describe, expect, it } from "vitest";
import type { Entity } from "../src/sim/entity";
import { DEFAULT_BRAIN_SPEC, seasonAbundanceAt, World, type WorldConfig } from "../src/sim/world";

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
        mateRange: 3,
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

    it("produces offspring from two parents when mates are near", () => {
        const config = makeConfig(11, {
            herbivoreCount: 2,
            carnivoreCount: 0,
            plantCount: 300,
            plantRegrowPerTick: 5,
            turnLength: 10,
            populationCap: 50,
        });
        const world = new World(config);
        // Bring both herbivores together at full energy so they can mate.
        for (const e of world.entities) {
            e.pos.x = 60;
            e.pos.y = 60;
            e.energy = e.species.maxEnergy;
        }
        let child: Entity | undefined;
        for (let i = 0; i < 200 && !child; i++) {
            world.tickStep();
            child = world.entities.find(
                (x) => x.parentIds !== null && x.parentIds[0] !== x.parentIds[1],
            );
        }
        expect(child).toBeDefined();
        expect(child!.parentIds![0]).not.toBe(child!.parentIds![1]);
    });

    it("reproduces: births are recorded", () => {
        // No carnivores: herbivores should reproduce early and often.
        const world = new World(makeConfig(5, { carnivoreCount: 0 }));
        for (let i = 0; i < 300; i++) world.tickStep();
        const totalBirths = world.records.reduce((sum, r) => sum + r.births.herbivore, 0);
        expect(totalBirths).toBeGreaterThan(0);
    });

    it("normalizes the season position for visuals", () => {
        expect(seasonAbundanceAt(100, 0, 0.5)).toBe(0.5); // seasons off = neutral
        // seasonLength 2000: trough at tick 500, peak at tick 1500.
        expect(seasonAbundanceAt(500, 2000, 0.5)).toBe(0);
        expect(seasonAbundanceAt(1500, 2000, 0.5)).toBe(1);
        expect(seasonAbundanceAt(1000, 2000, 0.5)).toBeCloseTo(0.5, 5);
        expect(seasonAbundanceAt(0, 2000, 0.5)).toBeCloseTo(0.5, 5);

        const world = new World(makeConfig(1, { plantSeasonLength: 2000, plantSeasonDepth: 0.5 }));
        expect(world.seasonAbundance).toBeCloseTo(0.5, 5);
    });

    it("modulates plant regrowth seasonally while keeping the long-run average", () => {
        // No animals: plants only grow, so plants.length tracks cumulative spawns.
        const world = new World(
            makeConfig(7, {
                herbivoreCount: 0,
                carnivoreCount: 0,
                plantCount: 0,
                plantRegrowPerTick: 1,
                maxPlants: 100000,
                plantSeasonLength: 2000,
                plantSeasonDepth: 0.5,
            }),
        );
        for (let i = 0; i < 1000; i++) world.tickStep(); // trough: sin(phase) > 0
        const troughSpawns = world.plants.length;
        for (let i = 0; i < 1000; i++) world.tickStep(); // peak: sin(phase) < 0
        const peakSpawns = world.plants.length - troughSpawns;

        // A full cycle spawns ≈ 2000 plants: the average regrow rate is unchanged.
        expect(world.plants.length).toBeGreaterThan(1950);
        expect(world.plants.length).toBeLessThan(2050);
        // The trough starves (rate dips below 1) and the peak booms.
        expect(troughSpawns).toBeLessThan(900);
        expect(peakSpawns).toBeGreaterThan(1100);
    });
});