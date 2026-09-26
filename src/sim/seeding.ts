/**
 * The seeding — the single source of truth for run parameters.
 *
 * Game rules: the 老天爺 chooses these values once at seeding and they are
 * locked for the whole run. Both the live app (main.ts) and the balance
 * probe (tests/balance-probe.test.ts) must derive their config from here
 * so a validated seeding can never drift out of the validated envelope.
 *
 * Validated by tests/balance-probe.test.ts under the local-frame sensory
 * encoding (rule 8): the locked seeding sustains both species for 30,000+
 * ticks under terminal-extinction rules with the carrion cycle active, and
 * finished the horizon with the healthiest final balance of the sweep
 * (herbivores 33, carnivores 38). Re-validate whenever an ecosystem
 * mechanic changes.
 */
import { DEFAULT_BRAIN_SPEC, type WorldConfig } from "./world";

export function makeSeeding(seed = 20260907): WorldConfig {
    return {
        width: 120,
        height: 120,
        seed,
        herbivoreCount: 60,
        carnivoreCount: 3,
        plantCount: 240,
        plantRegrowPerTick: 1,
        plantEnergy: 18,
        maxPlants: 500,
        turnLength: 100,
        populationCap: 500,
        mateRange: 3,
        mutationRate: 0.06,
        mutationSigma: 0.35,
        brainSpec: DEFAULT_BRAIN_SPEC,
    };
}
