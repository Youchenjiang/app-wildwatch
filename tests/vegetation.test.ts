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
    const seen = new Set<number>(world.plants.map((p) => p.id));
    for (let i = 0; i < ticks; i++) {
        world.tickStep();
        for (const p of world.plants) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            field[Math.floor(p.y / CELL) * GRID + Math.floor(p.x / CELL)]++;
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
    const total = field.reduce((a, b) => a + b, 0);
    const mean = total / field.length;
    if (mean === 0) return 0;
    const variance = field.reduce((acc, c) => acc + (c - mean) ** 2, 0) / field.length;
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
    for (let w = 0; w < windows; w++) {
        const field = productionField(world, ticksPerWindow);
        const total = field.reduce((a, b) => a + b, 0);
        if (prev !== null && total > 0) {
            const mean = total / field.length;
            const ranked = prev.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
            const best = ranked.slice(0, Math.round(field.length * 0.25)).map(([, i]) => i);
            const good = best.reduce((a, i) => a + field[i], 0);
            ratios.push(good / best.length / mean);
        }
        prev = field;
    }
    return ratios.reduce((a, b) => a + b, 0) / ratios.length;
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
                    const c = makeSeeding(20260907);
                    c.plantSpread = 0;
                    c.plantSpacing = 0;
                    c.plantColoniseChance = 0;
                    return c;
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
            for (let i = 0; i < 3000; i++) uniform.tickStep();
            // Independent positions: being in last window's best ground must
            // predict nothing.
            const flat = persistence(uniform, 6, 800);
            expect(flat).toBeGreaterThan(0.85);
            expect(flat).toBeLessThan(1.15);

            const dispersed = new World(makeSeeding(20260907));
            for (let i = 0; i < 3000; i++) dispersed.tickStep();
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
        const spread = config.plantSpread!;
        const world = new World(config);
        for (let i = 0; i < 3000; i++) world.tickStep();

        const known = new Set<number>(world.plants.map((p) => p.id));
        let local = 0;
        let travelled = 0;
        for (let i = 0; i < 3000; i++) {
            world.tickStep();
            const newborns = world.plants.filter((p) => !known.has(p.id));
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
        const a = new World(config);
        const b = new World(config);
        for (let i = 0; i < 3000; i++) {
            a.tickStep();
            b.tickStep();
            expect(a.plants.length).toBeLessThanOrEqual(cap);
        }
        // Dispersal draws from the seeded RNG, so two runs of the same seeding
        // must place the grass identically, down to the coordinates.
        expect(a.plants.length).toBe(b.plants.length);
        for (let i = 0; i < a.plants.length; i++) {
            expect(a.plants[i].x).toBe(b.plants[i].x);
            expect(a.plants[i].y).toBe(b.plants[i].y);
        }
    }, 300000);
});
