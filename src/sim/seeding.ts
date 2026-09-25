/**
 * The seeding — the single source of truth for run parameters.
 *
 * Game rules: the 老天爺 chooses these values once at seeding and they are
 * locked for the whole run. Both the live app (main.ts) and the balance
 * probe (tests/balance-probe.test.ts) must derive their config from here
 * so a validated seeding can never drift out of the validated envelope.
 *
 * Validated by tests/balance-probe.test.ts under the local-frame sensory
 * encoding (rule 8), the carrion cycle, seasonal vegetation (rule 9) and the
 * turn-energy cost: every candidate in the sweep sustains both species for
 * the full 30,000-tick horizon (the locked seeding itself finishes at
 * h=31 c=41). Re-validate whenever an ecosystem mechanic changes.
 */
import { DEFAULT_BRAIN_SPEC, type WorldConfig } from "./world";
import { iceAgeEra } from "./era";
import type { EraConfig } from "./era";

export function makeSeeding(seed = 20260907, era?: EraConfig): WorldConfig {
    const plant = era?.plants ?? {};
    return {
        width: 120,
        height: 120,
        seed,
        herbivoreCount: 60,
        carnivoreCount: 3,
        plantCount: 240,
        plantRegrowPerTick: plant.regrowPerTick ?? 1,
        plantEnergy: plant.energy ?? 18,
        maxPlants: plant.maxPlants ?? 500,
        turnLength: 100,
        populationCap: 500,
        mateRange: 3,
        mutationRate: 0.06,
        mutationSigma: 0.35,
        brainSpec: DEFAULT_BRAIN_SPEC,
        plantSeasonLength: 3000,
        plantSeasonDepth: 0.5,
        era,
    };
}

export function grasslandSeeding(seed = 20260907): WorldConfig {
    return makeSeeding(seed, undefined);
}

export function iceAgeSeeding(seed = 20260907): WorldConfig {
    return {
        ...makeSeeding(seed, iceAgeEra),
        carnivoreCount: 1,
    };
}

/** Ice-age seeding tuned for the era's lower energy throughput: fewer
 * starting carnivores so herbivores can establish before predation ramps up. */
export function iceAgeSeedingTuned(seed = 20260907): WorldConfig {
    return {
        ...iceAgeSeeding(seed),
        carnivoreCount: 2,
        herbivoreCount: 80,
        plantCount: 280,
    };
}
