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
 * h=54 c=63, with every alternate seeding in the sweep surviving too). That
 * baseline has moved three times, deliberately each time. First when sensing
 * and eating reach became true distances rather than grid-cell scans — at the
 * old values a 1.1-unit eat radius reached about 10 units. Then when vegetation
 * gained geography (plantSpread/plantSpacing/plantColoniseChance below): grass
 * grows from grass in patches instead of appearing at independent uniform
 * positions, which is what gives a forager somewhere worth going. Setting
 * plantSpread to 0 restores the old even sprinkle exactly, h=28 c=49. Most
 * recently when a tuft became several mouthfuls (plantBites below, h=53 c=50
 * before it): the food per tuft is unchanged, but a grazer can finish the tuft
 * it is standing on instead of having to find another, which is easier food to
 * reach and so a larger predator population at the same supply (c=50 -> 63).
 * Each era carries its own validated starting counts
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
        // A tuft is three mouthfuls of the same total food, not three times the
        // food: a grazer standing in a patch can finish it without ranging on.
        plantBites: 3,
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
        plantSpread: plant.spread ?? 4,
        plantSpacing: plant.spacing ?? 2,
        plantColoniseChance: plant.coloniseChance ?? 0.05,
        era,
    };
}
