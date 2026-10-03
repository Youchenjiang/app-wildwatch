import { describe, expect, it } from "vitest";
import { World, type ReproductionMode, type WorldConfig } from "../src/sim/world";
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
 * must reproduce the documented baseline (h=54 c=63) exactly.
 */
const ERAS: readonly EraConfig[] = [grasslandEra, iceAgeEra, desertEra];

function runEra(era: EraConfig): {
    ticks: number;
    herb: number;
    carn: number;
    carrionMeals: number;
    kinMeals: number;
    kinAncestor: number;
    kinDescendant: number;
    maxLivingDepth: number;
    kinDensity: number;
} {
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
        `era ${era.name.padEnd(10)} ${status}, final h=${herb} c=${carn}, season=${era.plants.seasonLength}/${era.plants.seasonDepth}, ` +
            `kin=${world.kinMealsEaten}/${world.carrionMealsEaten}, depth=${world.records.reduce((maxDepth, rec) => Math.max(maxDepth, rec.livingMaxDepth), 0)} ` +
            `liveForebears=${(world.records.reduce((maxDensity, rec) => Math.max(maxDensity, rec.kinDensity), 0) * 100).toFixed(0)}%`,
    );
    return {
        ticks: endedAt < 0 ? MAX_TICKS : endedAt,
        herb,
        carn,
        carrionMeals: world.carrionMealsEaten,
        kinMeals: world.kinMealsEaten,
        kinAncestor: world.kinAncestorMealsEaten,
        kinDescendant: world.kinDescendantMealsEaten,
        // The deepest reading of the run, not the final one: a population that
        // crashed late would otherwise report a small value.
        maxLivingDepth: world.records.reduce((maxDepth, rec) => Math.max(maxDepth, rec.livingMaxDepth), 0),
        kinDensity: world.records.reduce((maxDensity, rec) => Math.max(maxDensity, rec.kinDensity), 0),
    };
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
        // Moved deliberately when sensing and eating reach became true
        // distances (it was h=31 c=41 while eatRadius only chose which grid
        // cells to scan, which gave both species a reach of about a cell), then
        // when vegetation gained geography (h=28 c=49 while grass grew at
        // independent uniform positions and no place was worth going to), and
        // most recently when a tuft became three mouthfuls instead of one
        // (h=53 c=50 -> h=54 c=63: the same food per tuft, but reachable without
        // leaving the patch, which is what a predator population follows).
        const grassland = results.find((resultItem) => resultItem.era.name === "Grassland");
        expect(grassland).toBeDefined();
        if (!grassland) {
            throw new Error("Grassland era missing");
        }
        expect(grassland.herb, "grassland baseline drifted").toBe(54);
        expect(grassland.carn, "grassland baseline drifted").toBe(63);

        // Kin feeding is only observable in a real run: it needs a parent and
        // its offspring to both die inside the same reach of a scavenger. A
        // unit test with a hand-placed corpse cannot catch the failure that
        // actually happened here — asking for kinship in one direction only,
        // which silently reported zero for the whole lineage forever. So pin
        // it against the live run instead of a fixture.
        // Living ancestry is likewise only real in a long run. It needs
        // animals to breed and die over hundreds of turns, which no fixture
        // reproduces, and a reading pinned at zero would mean the walk is
        // broken rather than that the population is unrelated.
        expect(grassland.maxLivingDepth, "the living population never aged").toBeGreaterThan(0);
        expect(grassland.kinDensity, "no living animal ever had a living forebear").toBeGreaterThan(0);
        expect(grassland.kinDensity).toBeLessThanOrEqual(1);

        expect(grassland.carrionMeals, "no corpse was ever eaten").toBeGreaterThan(0);
        expect(grassland.kinMeals, "kin feeding silently stopped firing").toBeGreaterThan(0);
        expect(
            grassland.kinAncestor + grassland.kinDescendant,
            "kin split does not add up to the kin total",
        ).toBe(grassland.kinMeals);
    }, 240000);
});

/**
 * Reproduction mode — a seeding choice the player makes, so it is validated the
 * same way an era preset is: `asexual` must be exactly the locked baseline
 * (cloning is what runs have always done in practice), and `sexual` must really
 * be sexual: it must make sexual births and not one single clonal birth.
 *
 * `sexual` is NOT asserted to survive. A sexual animal that meets no partner
 * does not breed at all, and at these densities a carnivore rarely meets one,
 * so the predator line dies out within a few thousand ticks. That is the mode
 * working as specified rather than a failure — the run is reported so the cost
 * of the choice is visible, instead of being asserted away or papered over with
 * a clone fallback.
 */
describe("reproduction mode sweep", () => {
    const runMode = (mode: ReproductionMode) => {
        const world = new World(makeSeeding(20260907, grasslandEra, mode));
        let endedAt = -1;
        for (let i = 1; i <= MAX_TICKS; i++) {
            world.tickStep();
            if (world.gameOver !== null) {
                endedAt = i;
                break;
            }
        }
        const status = endedAt < 0 ? `SURVIVED to ${MAX_TICKS}` : `ended ${endedAt} (${world.gameOver})`;
        const result = {
            mode,
            ticks: endedAt < 0 ? MAX_TICKS : endedAt,
            herb: world.populationOf("herbivore"),
            carn: world.populationOf("carnivore"),
            sexual: world.sexualBirths,
            asexual: world.asexualBirths,
        };
        console.log(
            `mode ${mode.padEnd(8)} ${status}, final h=${result.herb} c=${result.carn}, ` +
                `sexual=${result.sexual} asexual=${result.asexual}`,
        );
        return result;
    };

    it("every selectable mode does what it says", () => {
        const asexual = runMode("asexual");
        const sexual = runMode("sexual");

        // Asexual must reproduce the locked grassland baseline exactly: choosing
        // it explicitly is not allowed to be a different run from the default.
        expect(asexual.ticks, "asexual mode did not sustain the baseline").toBe(TARGET_TICKS);
        expect(asexual.herb, "asexual baseline drifted").toBe(54);
        expect(asexual.carn, "asexual baseline drifted").toBe(63);
        expect(asexual.sexual, "asexual mode mated anyway").toBe(0);

        // Sexual must actually fire, and never quietly fall back to cloning.
        expect(sexual.sexual, "sexual mode never mated").toBeGreaterThan(0);
        expect(sexual.asexual, "sexual mode cloned anyway").toBe(0);
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
    }, 480000);
});
