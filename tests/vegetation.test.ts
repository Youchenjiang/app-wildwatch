import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
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

/**
 * Tally what a window of grazing actually took, from the outside.
 *
 * Bites are counted from each herbivore's lifetime plant count rather than from
 * its meal log, because the log only keeps the newest few meals (evicting old
 * ones) while the counters last the whole run.
 *
 * `vanished` counts tufts standing at one tick boundary and gone at the next,
 * so bites over vanishings is the population-level reading of `plantBites`: how
 * many mouthfuls a tuft turned out to be worth. `bornBitten` counts tufts first
 * seen at a boundary already missing a mouthful — nothing else can have bitten
 * them, since they did not exist at the previous boundary.
 */
function grazing(config: WorldConfig, ticks: number) {
    const world = new World(config);
    const full = world.plantParams.bites;
    const biteEnergy = world.plantParams.biteEnergy;
    let known = new Set<number>(world.plants.map((p) => p.id));
    let bites = 0;
    let overBites = 0;
    let emptyStanding = 0;
    let inconsistent = 0;
    let vanished = 0;
    let births = 0;
    let bornBitten = 0;
    for (let t = 0; t < ticks; t++) {
        const before = known;
        const countsBefore = new Map<number, number>();
        for (const e of world.entities) countsBefore.set(e.id, e.meals.counts().plant);
        world.tickStep();
        for (const e of world.entities) {
            const delta = e.meals.counts().plant - (countsBefore.get(e.id) ?? 0);
            if (delta <= 0) continue;
            bites += delta;
            for (const meal of e.meals.recent(delta)) {
                if (Math.abs(meal.energy - biteEnergy) > 1e-9) overBites++;
            }
        }
        const ids = new Set<number>();
        for (const p of world.plants) {
            ids.add(p.id);
            if (p.bites <= 0 || p.energy <= 0) emptyStanding++;
            if (Math.abs(p.energy - p.bites * biteEnergy) > 1e-9) inconsistent++;
            if (!before.has(p.id)) {
                births++;
                if (p.bites < full) bornBitten++;
            }
        }
        for (const id of before) if (!ids.has(id)) vanished++;
        known = ids;
    }
    return { world, bites, overBites, emptyStanding, inconsistent, vanished, births, bornBitten };
}

/**
 * A world holding one tuft with a grazer standing on it.
 *
 * Regrowth is off, so the tuft cannot be replaced, and the grazer is put back
 * on the tuft before every tick: this is about what a bite takes, not about
 * whether the brain chooses to stay.
 */
function singleTuft(bites: number) {
    const config = makeSeeding(20260907);
    config.plantCount = 1;
    config.maxPlants = 1;
    config.plantRegrowPerTick = 0;
    config.plantSeasonLength = 0;
    config.plantBites = bites;
    config.herbivoreCount = 1;
    config.carnivoreCount = 0;
    const world = new World(config);
    const tuft = world.plants[0];
    const grazer = world.entities[0];
    return {
        world,
        tuft,
        grazer,
        biteOnce: () => {
            grazer.pos.x = tuft.x;
            grazer.pos.y = tuft.y;
            world.tickStep();
        },
    };
}

/**
 * A tuft is three mouthfuls, and it is bite-sized from the moment it appears.
 *
 * The division is the whole point of the feature: `plantEnergy` is shared among
 * `plantBites` mouthfuls, so a tuft is still worth exactly the food it was
 * worth before, and the only thing that changed is that a grazer standing in a
 * patch can finish it instead of having to find another tuft. These tests pin
 * both halves — one mouthful per bite, and `plantBites` mouthfuls per tuft — so
 * a change to either cannot quietly move the food budget the seeding was
 * validated against. `plantBites: 1` is also pinned: it is the model this
 * replaced, and every test fixture that seeds its own world still gets it.
 */
describe("grazing a tuft", () => {
    it("is worth exactly as many mouthfuls as it has bites", () => {
        const { world, tuft, grazer, biteOnce } = singleTuft(3);
        expect(world.plantParams.biteEnergy).toBeCloseTo(world.config.plantEnergy / 3, 10);
        const before = grazer.fitness;
        for (let taken = 1; taken <= 3; taken++) {
            biteOnce();
            if (taken < 3) {
                expect(world.plants.length, `the tuft stood through bite ${taken}`).toBe(1);
                expect(tuft.bites, `bites left after ${taken}`).toBe(3 - taken);
                expect(tuft.energy).toBeCloseTo(
                    (3 - taken) * world.plantParams.biteEnergy,
                    10,
                );
            } else {
                expect(world.plants.length, "the last bite finished the tuft").toBe(0);
            }
        }
        // Three mouthfuls are worth the whole tuft and no more: same food per
        // tuft as a single-bite world, taken three times.
        expect(grazer.fitness - before).toBeCloseTo(world.config.plantEnergy, 6);
    }, 60000);

    it("takes one mouthful at a time and leaves the rest standing", () => {
        const { bites, overBites, emptyStanding, inconsistent, vanished } = grazing(
            makeSeeding(20260907),
            3000,
        );
        expect(bites, "no herbivore ate anything in the window").toBeGreaterThan(50);
        expect(overBites, "a bite was worth more than one mouthful").toBe(0);
        expect(emptyStanding, "a tuft stood with no bites left in it").toBe(0);
        expect(inconsistent, "a standing tuft's energy did not match its bites").toBe(0);
        const perTuft = bites / vanished;
        expect(perTuft, "the field is not being grazed one mouthful at a time").toBeGreaterThan(2.8);
        expect(perTuft, "a tuft gave up more mouthfuls than it holds").toBeLessThan(3.2);
    }, 60000);

    it("can be bitten in the very tick it appears", () => {
        // Regrowth runs before the animals move and files each sprout in the
        // plant index as it appears, so a tuft is grazeable the tick it appears.
        // A newborn that is already missing a mouthful at the next boundary was
        // bitten before that tick was out: it cannot have been bitten earlier,
        // because it did not exist earlier.
        const { births, bornBitten } = grazing(makeSeeding(20260907), 3000);
        expect(births, "no tuft grew in the window").toBeGreaterThan(50);
        expect(bornBitten, "no tuft is ever bitten in its birth tick").toBeGreaterThan(0);
        expect(bornBitten / births, "newborns are bitten only by accident").toBeGreaterThan(0.02);
    }, 60000);

    it("is grazed whole again when it holds a single bite", () => {
        // `plantBites: 1` is the model this replaced, and it has to stay exact:
        // a fixture that seeds its own world gets a bite worth the whole tuft
        // unless it asks for more.
        const { world, tuft, grazer, biteOnce } = singleTuft(1);
        expect(tuft.bites).toBe(1);
        const before = grazer.fitness;
        biteOnce();
        expect(world.plants.length, "one bite finished the tuft").toBe(0);
        expect(grazer.fitness - before).toBeCloseTo(world.config.plantEnergy, 6);
    }, 60000);

    it("spreads from a tuft that may itself have just appeared", () => {
        // No plant carries a maturity stage: the parent is picked uniformly
        // from the living plants, so a sprout is a candidate parent in the same
        // tick it appears. One seed tuft with two sprouts allowed in a tick,
        // no colonising (so no seed lands anywhere at random) and no spacing
        // rejection makes this decidable: the second sprout's parent is either
        // the seed tuft or the sprout made moments earlier, so landing further
        // than `spread` from the seed tuft can only mean the newborn was the
        // parent.
        const spread = 4;
        let tested = 0;
        let parentedByNewborn = 0;
        let furthest = 0;
        for (let seed = 1; seed <= 200; seed++) {
            const config = makeSeeding(seed);
            config.plantCount = 1;
            config.maxPlants = 3;
            config.plantRegrowPerTick = 2;
            config.plantSpread = spread;
            config.plantSpacing = 0;
            config.plantColoniseChance = 0;
            config.plantSeasonLength = 0;
            config.herbivoreCount = 1;
            config.carnivoreCount = 1;
            const world = new World(config);
            const seedTuft = world.plants[0];
            world.tickStep();
            if (world.plants.length < 3) continue; // a grazer got there first
            tested++;
            const newest = world.plants[2];
            const distance = Math.hypot(newest.x - seedTuft.x, newest.y - seedTuft.y);
            furthest = Math.max(furthest, distance);
            if (distance > spread) parentedByNewborn++;
        }
        expect(tested, "the single-tuft world did not make three plants").toBeGreaterThan(150);
        expect(furthest, "a sprout never landed past the seed tuft's reach").toBeGreaterThan(spread);
        expect(parentedByNewborn, "no plant was parented by one that appeared in the same tick").toBeGreaterThan(5);
    }, 60000);
});
