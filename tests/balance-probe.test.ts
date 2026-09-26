import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

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

describe("seeding sweep", () => {
    it("finds a seeding that sustains both species", () => {
        const results: Array<{ label: string; ticks: number }> = [];
        for (const s of SEEDINGS) {
            results.push({ label: s.label, ticks: runSeeding(s.label, s.overrides) });
        }
        const best = Math.max(...results.map((r) => r.ticks));
        console.log(
            "ranking:",
            results
                .slice()
                .sort((a, b) => b.ticks - a.ticks)
                .map((r) => `${r.label}:${r.ticks}`)
                .join("  "),
        );
        expect(best).toBeGreaterThanOrEqual(TARGET_TICKS);
    }, 240000);
});
