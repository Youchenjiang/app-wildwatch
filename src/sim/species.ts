import type { SpeciesParams } from "./types";

/**
 * Baseline species presets (grassland era).
 * The scenario milestone will vary these per scene and era.
 */
export const SPECIES: Record<SpeciesParams["kind"], SpeciesParams> = {
    herbivore: {
        kind: "herbivore",
        name: "Herbivore",
        color: 0x7ec850,
        speed: 1.6,
        maxTurn: 1.1,
        senseRange: 14,
        eatRadius: 1.1,
        moveCost: 0.05,
        maxEnergy: 100,
        reproduceEnergy: 60,
        reproduceCost: 30,
        litterSize: 1,
        maxAge: 1600,
        foodEnergy: 18,
    },
    carnivore: {
        kind: "carnivore",
        name: "Carnivore",
        color: 0xc84f4f,
        speed: 2.2,
        maxTurn: 1.3,
        senseRange: 18,
        eatRadius: 1.2,
        moveCost: 0.09,
        maxEnergy: 100,
        reproduceEnergy: 65,
        reproduceCost: 32,
        litterSize: 1,
        maxAge: 2000,
        foodEnergy: 40,
    },
};