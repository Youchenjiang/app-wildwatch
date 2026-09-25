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
 * h=31 c=41). Each era carries its own validated starting counts
 * (EraConfig.seeding) so a run seeded from an era never drifts out of the
 * envelope that era was tuned in. Re-validate whenever an ecosystem mechanic
 * or era preset changes.
 */
import { DEFAULT_BRAIN_SPEC, type ReproductionMode, type WorldConfig } from "./world";
import type { EraConfig } from "./era";

/** Shared defaults for a run with no era (and for era fields left unset). */
export const BASE_SEEDING = {
    herbivoreCount: 60,
    carnivoreCount: 3,
    plantCount: 240,
} as const;

export function makeSeeding(
    seed = 20260907,
    era?: EraConfig,
    reproduction: ReproductionMode = "asexual",
): WorldConfig {
    const plant = era?.plants ?? {};
    const counts = era?.seeding ?? {};
    return {
        width: 120,
        height: 120,
        seed,
        herbivoreCount: counts.herbivoreCount ?? BASE_SEEDING.herbivoreCount,
        carnivoreCount: counts.carnivoreCount ?? BASE_SEEDING.carnivoreCount,
        plantCount: counts.plantCount ?? BASE_SEEDING.plantCount,
        plantRegrowPerTick: plant.regrowPerTick ?? 1,
        plantEnergy: plant.energy ?? 18,
        maxPlants: plant.maxPlants ?? 500,
        turnLength: 100,
        populationCap: 500,
        mateRange: 3,
        reproduction,
        mutationRate: 0.06,
        mutationSigma: 0.35,
        brainSpec: DEFAULT_BRAIN_SPEC,
        plantSeasonLength: plant.seasonLength ?? 3000,
        plantSeasonDepth: plant.seasonDepth ?? 0.5,
        era,
    };
}
