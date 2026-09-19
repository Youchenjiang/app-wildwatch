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
        speed: 1.6,
        maxTurn: 1.1,
        senseRange: 14,
        eatRadius: 1.1,
        moveCost: 0.05,
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
        speed: 1.9,
        maxTurn: 1.3,
        senseRange: 10,
        eatRadius: 1.2,
        moveCost: 0.18,
        maxEnergy: 100,
        reproduceEnergy: 130,
        reproduceCost: 105,
        litterSize: 1,
        maxAge: 1200,
        foodEnergy: 8,
    },
};