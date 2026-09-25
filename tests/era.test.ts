import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import { desertEra, grasslandEra, iceAgeEra } from "../src/sim/era";
import { seasonAbundanceAt, seasonalRegrowMultiplier } from "../src/sim/world";

describe("era presets", () => {
    it("grassland reproduces the validated baseline seeding", () => {
        const c = makeSeeding(20260907, grasslandEra);
        expect(c.herbivoreCount).toBe(60);
        expect(c.carnivoreCount).toBe(3);
        expect(c.plantCount).toBe(240);
        expect(c.plantRegrowPerTick).toBe(1);
        expect(c.plantEnergy).toBe(18);
        expect(c.maxPlants).toBe(500);
        expect(c.plantSeasonLength).toBe(3000);
        expect(c.plantSeasonDepth).toBe(0.5);
        // The era-free (legacy) seeding must resolve to the same values.
        const { era: _bareEra, ...bare } = makeSeeding();
        const { era: _grassEra, ...grass } = c;
        expect(bare).toEqual(grass);
    });

    it("an era owns its vegetation cycle and starting counts", () => {
        const ice = makeSeeding(20260907, iceAgeEra);
        expect(ice.plantSeasonLength).toBe(3400);
        expect(ice.plantSeasonDepth).toBe(0.4);
        expect(ice.carnivoreCount).toBe(1);

        const desert = makeSeeding(20260907, desertEra);
        expect(desert.plantSeasonLength).toBe(5000);
        expect(desert.plantSeasonDepth).toBe(0.6);
        expect(desert.plantRegrowPerTick).toBe(0.55);
        expect(desert.plantEnergy).toBe(26);
        expect(desert.maxPlants).toBe(340);
    });

    it("the world resolves era species params onto spawned entities", () => {
        const base = new World(makeSeeding());
        const desert = new World(makeSeeding(20260907, desertEra));
        const herb = (w: World) => w.entities.find((e) => e.species.kind === "herbivore")!.species;
        const carn = (w: World) => w.entities.find((e) => e.species.kind === "carnivore")!.species;

        // Desert herbivores must range further to find sparse plants.
        expect(herb(desert).senseRange).toBeGreaterThan(herb(base).senseRange);
        expect(carn(desert).moveCost).toBeLessThan(carn(base).moveCost);
        // Base (no era) still uses the shared SPECIES params.
        expect(herb(base).senseRange).toBe(14);
    });

    it("seasonAbundance spans the era's own trough depth", () => {
        for (const era of [grasslandEra, iceAgeEra, desertEra]) {
            const length = era.plants.seasonLength!;
            const depth = era.plants.seasonDepth!;
            // Deepest trough: quarter-cycle in. Peak: three-quarter cycle in.
            expect(seasonAbundanceAt(Math.round(length / 4), length, depth)).toBeCloseTo(0, 5);
            expect(seasonAbundanceAt(Math.round((3 * length) / 4), length, depth)).toBeCloseTo(1, 5);
            expect(seasonalRegrowMultiplier(Math.round(length / 4), length, depth)).toBeCloseTo(1 - depth, 5);
        }
    });
});
