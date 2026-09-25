import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import { desertEra, grasslandEra, iceAgeEra, type EraConfig } from "../src/sim/era";

/**
 * Seeding sweep — the "老天爺" training loop in miniature.
 *
 * Game rules: all params are chosen once at seeding and locked; the only
 * environment behavior is occasional random plant growth; extinction of
 * either species is terminal and ends the run. So the score of a seeding
 * is simply how long the run stays alive.
 *
 * Candidates derive from the shared makeSeeding() so the probe can never
 * validate a seeding the live app is not running.
 */
function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
    return { ...makeSeeding(), ...overrides };
}

/** Candidate seedings: vary plant inflow, resource base, and predator load. */
const SEEDINGS: ReadonlyArray<{ label: string; overrides: Partial<WorldConfig> }> = [
    { label: "r1 c4 mp500", overrides: { plantRegrowPerTick: 1, carnivoreCount: 4, maxPlants: 500 } },
    { label: "r1 c4 pe22", overrides: { plantRegrowPerTick: 1, carnivoreCount: 4, plantEnergy: 22 } },
    { label: "r2 c4 mp500", overrides: { plantRegrowPerTick: 2, carnivoreCount: 4, maxPlants: 500 } },
    { label: "r1 c3 mp500", overrides: { plantRegrowPerTick: 1, carnivoreCount: 3, maxPlants: 500 } },
    { label: "r2 c3 mp500", overrides: { plantRegrowPerTick: 2, carnivoreCount: 3, maxPlants: 500 } },
];

const MAX_TICKS = 30000;
const TARGET_TICKS = 30000;

function runSeeding(label: string, overrides: Partial<WorldConfig>): number {
    const world = new World(makeConfig(overrides));
    let endedAt = -1;
    let maxHerb = 0;
    let maxCarn = 0;
    for (let i = 1; i <= MAX_TICKS; i++) {
        world.tickStep();
        maxHerb = Math.max(maxHerb, world.populationOf("herbivore"));
        maxCarn = Math.max(maxCarn, world.populationOf("carnivore"));
        if (world.gameOver !== null) {
            endedAt = i;
            break;
        }
    }
    const status =
        endedAt < 0
            ? `SURVIVED to ${MAX_TICKS}`
            : `ended ${endedAt} (${world.gameOver} extinct)`;
    console.log(
        `${label.padEnd(10)} ${status}, final h=${world.populationOf("herbivore")} c=${world.populationOf("carnivore")}, max h=${maxHerb} c=${maxCarn}`,
    );
    return endedAt < 0 ? MAX_TICKS : endedAt;
}

/**
 * Era sweep — an era is a seeding preset: it carries species tuning, the
 * vegetation cycle and its own starting counts. The welcome screen seeds a
 * run straight from makeSeeding(seed, era), so an era is only valid if that
 * seeding survives the same 30,000-tick horizon as the baseline. Grassland
 * must reproduce the documented baseline (h=31 c=41) exactly.
 */
const ERAS: readonly EraConfig[] = [grasslandEra, iceAgeEra, desertEra];

function runEra(era: EraConfig): { ticks: number; herb: number; carn: number } {
    const world = new World(makeSeeding(20260907, era));
    let endedAt = -1;
    for (let i = 1; i <= MAX_TICKS; i++) {
        world.tickStep();
        if (world.gameOver !== null) {
            endedAt = i;
            break;
        }
    }
    const status = endedAt < 0 ? `SURVIVED to ${MAX_TICKS}` : `ended ${endedAt} (${world.gameOver} extinct)`;
    const herb = world.populationOf("herbivore");
    const carn = world.populationOf("carnivore");
    console.log(
        `era ${era.name.padEnd(10)} ${status}, final h=${herb} c=${carn}, season=${era.plants.seasonLength}/${era.plants.seasonDepth}`,
    );
    return { ticks: endedAt < 0 ? MAX_TICKS : endedAt, herb, carn };
}

describe("era sweep", () => {
    it("every era preset sustains both species", () => {
        const results = ERAS.map((era) => ({ era, ...runEra(era) }));
        console.log(
            "era ranking:",
            results.map((resultItem) => `${resultItem.era.name}:${resultItem.ticks}`).join("  "),
        );
        for (const res of results) {
            expect(res.ticks, `${res.era.name} seeding went extinct early`).toBeGreaterThanOrEqual(TARGET_TICKS);
        }
        // Grassland is the locked reference seeding, so its exact outcome is
        // the determinism canary: a mechanic that changes behavior must move
        // this number deliberately (and be re-validated), never by accident.
        const grassland = results.find((r) => r.era.name === "Grassland")!;
        expect(grassland.herb, "grassland baseline drifted").toBe(31);
        expect(grassland.carn, "grassland baseline drifted").toBe(41);
    }, 240000);
});

describe("seeding sweep", () => {
    it("finds a seeding that sustains both species", () => {
        const results: Array<{ label: string; ticks: number }> = [];
        for (const candidate of SEEDINGS) {
            results.push({ label: candidate.label, ticks: runSeeding(candidate.label, candidate.overrides) });
        }
        const best = Math.max(...results.map((entry) => entry.ticks));
        console.log(
            "ranking:",
            results
                .slice()
                .sort((first, second) => second.ticks - first.ticks)
                .map((entry) => `${entry.label}:${entry.ticks}`)
                .join("  "),
        );
        expect(best).toBeGreaterThanOrEqual(TARGET_TICKS);
    }, 240000);
});
