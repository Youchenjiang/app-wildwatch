import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

const CELL = 10;
const GRID = 12;
const CELLS = GRID * GRID;

/** With no dispersal, every plant lands at an independent uniform position. */
function uniformWorld() {
    const config = makeSeeding(20260907);
    config.plantSpread = 0;
    config.plantSpacing = 0;
    config.plantColoniseChance = 0;
    return new World(config);
}

/** Where grass keeps appearing, counted per cell over a window of ticks. */
function productionField(world: World, ticks: number): number[] {
    const field = new Array<number>(CELLS).fill(0);
    const seen = new Set<number>(world.plants.map((plant) => plant.id));
    for (let step = 0; step < ticks; step++) {
        world.tickStep();
        for (const plant of world.plants) {
            if (seen.has(plant.id)) continue;
            seen.add(plant.id);
            field[Math.floor(plant.y / CELL) * GRID + Math.floor(plant.x / CELL)]++;
        }
    }
    return field;
}

/**
 * Index of dispersion of a count field: variance / mean. A process with no
 * spatial structure scores ~1, and the more clumped the growth is, the higher
 * it goes. This is the number that says whether grass has geography at all.
 */
function dispersion(field: readonly number[]): number {
    const total = field.reduce((sum, val) => sum + val, 0);
    const mean = total / field.length;
    if (mean === 0) return 0;
    const variance = field.reduce((acc, val) => acc + (val - mean) ** 2, 0) / field.length;
    return variance / mean;
}

/**
 * Does a place that produced grass keep producing it?
 *
 * Rank cells by one window's growth, then measure how the best quarter of them
 * yields in the next window, relative to the world average. This is what makes
 * foraging learnable: at ~1.0 a good patch is worth nothing, because the field
 * is noise and no memory of a place can pay for the trip.
 */
function persistence(world: World, windows: number, ticksPerWindow: number): number {
    const ratios: number[] = [];
    let prev: number[] | null = null;
    for (let windowIndex = 0; windowIndex < windows; windowIndex++) {
        const field = productionField(world, ticksPerWindow);
        const total = field.reduce((sum, val) => sum + val, 0);
        if (prev !== null && total > 0) {
            const mean = total / field.length;
            const ranked = prev.map((val, idx) => [val, idx] as const).sort((itemA, itemB) => itemB[0] - itemA[0]);
            const best = ranked.slice(0, Math.round(field.length * 0.25)).map(([, idx]) => idx);
            const good = best.reduce((sum, idx) => sum + field[idx], 0);
            ratios.push(good / best.length / mean);
        }
        prev = field;
    }
    return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

describe("vegetation geography", () => {
    it(
        "gives grass patches, where independent positions give none",
        () => {
            // The old world placed every plant independently, which measured as
            // a dispersion of ~1 over 16,000 ticks: an even sprinkle with no
            // place better than any other. This pins both halves of that claim,
            // so "foraging has something to learn" cannot quietly stop being
            // true if the dispersal model is disturbed.
            const uniform = new World(
                (() => {
                    const uniformConfig = makeSeeding(20260907);
                    uniformConfig.plantSpread = 0;
                    uniformConfig.plantSpacing = 0;
                    uniformConfig.plantColoniseChance = 0;
                    return uniformConfig;
                })(),
            );
            const uniformDispersion = dispersion(productionField(uniform, 6000));
            expect(uniformDispersion).toBeGreaterThan(0.7);
            expect(uniformDispersion).toBeLessThan(1.4);

            const dispersed = new World(makeSeeding(20260907));
            const dispersedDispersion = dispersion(productionField(dispersed, 6000));
            expect(dispersedDispersion, "grass stopped forming patches").toBeGreaterThan(3);
        },
        300000,
    );

    it(
        "keeps a good patch good, which is what makes ranging worth it",
        () => {
            const uniform = uniformWorld();
            for (let step = 0; step < 3000; step++) uniform.tickStep();
            // Independent positions: being in last window's best ground must
            // predict nothing.
            const flat = persistence(uniform, 6, 800);
            expect(flat).toBeGreaterThan(0.85);
            expect(flat).toBeLessThan(1.15);

            const dispersed = new World(makeSeeding(20260907));
            for (let step = 0; step < 3000; step++) dispersed.tickStep();
            const gradient = persistence(dispersed, 6, 800);
            expect(gradient, "a good patch no longer stays good").toBeGreaterThan(1.2);
        },
        300000,
    );

    it("grows most grass from grass, and lets the rest travel", () => {
        // Both paths are load-bearing. If every seed stayed local, grass would
        // be trapped in patches that have filled up and a grazed patch could
        // never return; if every seed travelled, the world would be back to the
        // even sprinkle this replaced. So the split is pinned around what the
        // model measures: roughly three quarters local, the rest travelling.
        const config = makeSeeding(20260907);
        const spread = config.plantSpread ?? 4;
        const world = new World(config);
        for (let step = 0; step < 3000; step++) world.tickStep();

        const known = new Set<number>(world.plants.map((plant) => plant.id));
        let local = 0;
        let travelled = 0;
        for (let step = 0; step < 3000; step++) {
            world.tickStep();
            const newborns = world.plants.filter((plant) => !known.has(plant.id));
            for (const baby of newborns) {
                known.add(baby.id);
                // Nearest other plant in the whole population, siblings from the
                // same tick included: a parent may itself have just appeared.
                let nearest = Infinity;
                for (const other of world.plants) {
                    if (other === baby) continue;
                    nearest = Math.min(nearest, Math.hypot(other.x - baby.x, other.y - baby.y));
                }
                if (nearest <= spread + 2) local++;
                else travelled++;
            }
        }
        const total = local + travelled;
        expect(total, "no plant grew in the window").toBeGreaterThan(50);
        expect(local / total, "grass stopped growing from grass").toBeGreaterThan(0.6);
        expect(travelled / total, "no seed ever travels any more").toBeGreaterThan(0.02);
    }, 300000);

    it("holds its ceiling and stays deterministic", () => {
        const config = makeSeeding(20260907);
        const cap = config.maxPlants;
        const worldA = new World(config);
        const worldB = new World(config);
        for (let step = 0; step < 3000; step++) {
            worldA.tickStep();
            worldB.tickStep();
            expect(worldA.plants.length).toBeLessThanOrEqual(cap);
        }
        // Dispersal draws from the seeded RNG, so two runs of the same seeding
        // must place the grass identically, down to the coordinates.
        expect(worldA.plants).toHaveLength(worldB.plants.length);
        for (let idx = 0; idx < worldA.plants.length; idx++) {
            expect(worldA.plants[idx].x).toBe(worldB.plants[idx].x);
            expect(worldA.plants[idx].y).toBe(worldB.plants[idx].y);
        }
    }, 300000);
});
