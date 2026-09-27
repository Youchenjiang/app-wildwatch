import type { SpeciesParams } from "./types";

/**
 * Baseline species presets (grassland era).
 * The scenario milestone will vary these per scene and era.
 */
export const SPECIES: Record<SpeciesParams["kind"], SpeciesParams> = {
    herbivore: {
        kind: "herbivore",
        name: "Herbivore",
        color: 0xd7f05a,
        /** Prey outrun predators in a straight chase; predators win via turns. */
        speed: 2.0,
        maxTurn: 1.1,
        senseRange: 14,
        /**
         * A real distance now, not a hint about which grid cells to scan (see
         * src/sim/spatial-grid.ts). It has to be comparable to a tick's travel
         * — 2.0 units — for grazing to land at all, so the value is set from
         * the measured balance sweep rather than picked by eye.
         */
        eatRadius: 3,
        moveCost: 0.05,
        /** Sustained hard turning burns extra energy — the cost of chasing. */
        turnCost: 1.0,
        maxEnergy: 100,
        reproduceEnergy: 70,
        reproduceCost: 45,
        litterSize: 1,
        maxAge: 1600,
        foodEnergy: 12,
    },
    carnivore: {
        kind: "carnivore",
        name: "Carnivore",
        color: 0xc84f4f,
        /** Slower in a chase but out-turns prey; relies on ambush + scavenging. */
        speed: 1.7,
        maxTurn: 1.3,
        senseRange: 10,
        /**
         * The predator's strike reach, and the tightest constraint in the world:
         * it must exceed what a fleeing herbivore (2.0 per tick) gains in one
         * tick or a hunt can never land. Measured: below ~3 the predator line
         * always starves out and the herbivores boom unchecked, at 4 it lasts
         * the full horizon across a wide band of grazing reaches.
         */
        eatRadius: 4,
        moveCost: 0.18,
        /** Cheaper absolute turn cost than herbivores despite the higher move cost. */
        turnCost: 0.8,
        maxEnergy: 100,
        reproduceEnergy: 130,
        reproduceCost: 105,
        litterSize: 1,
        maxAge: 1200,
        foodEnergy: 8,
    },
};