/** Era presets for the scenario milestone: each era redefines the biome palette
 * and can nudge species parameters so the same evolutionary engine plays out
 * differently on grassland, ice age, desert, etc.
 *
 * An era is declarative — it names the look and the selective pressures, and
 * the world mesh/atmosphere builders and the species seeding derive their
 * values from it. Runs that omit an era default to grassland.
 */
import type { SpeciesParams } from "./types";

/** How an era reshapes one species: a partial overlay on the base SpeciesParams.
 * Missing keys keep the base value. This keeps era presets small — only the
 * parameters that actually differ from grassland are listed.
 */
export type SpeciesOverlay = Partial<SpeciesParams>;

/** Per-era plant defaults (the seeding's plantRegrowPerTick / plantEnergy /
 * maxPlants can all be era-specific).
 */
export interface PlantOverlay {
    regrowPerTick?: number;
    energy?: number;
    maxPlants?: number;
}

/** A resolved era config: what the renderer, atmosphere and world construction
 * actually consume.
 */
export interface EraConfig {
    name: string;
    groundColor: number;
    groundTroughColor: number;
    skyColor: number;
    skyTroughColor: number;
    plantPeakColor: number;
    plantTroughColor: number;
    herbivore: SpeciesParams;
    carnivore: SpeciesParams;
    plants: PlantOverlay;
}

/** Merge a partial species overlay onto a base SpeciesParams, keeping every
 * unspecified key from the base.
 */
export function overlaySpecies(base: SpeciesParams, ov: SpeciesOverlay): SpeciesParams {
    return { ...base, ...ov };
}

/** Apply era plant overlays onto the seeding defaults.
 */
export function overlayPlants(baseRegrow: number, baseEnergy: number, baseMax: number, ov: PlantOverlay) {
    return {
        regrowPerTick: ov.regrowPerTick ?? baseRegrow,
        energy: ov.energy ?? baseEnergy,
        maxPlants: ov.maxPlants ?? baseMax,
    };
}

/** Grassland — the default era; matches the current validated seeding exactly. */
export const grasslandEra: EraConfig = {
    name: "Grassland",
    groundColor: 0x2e4631,
    groundTroughColor: 0x8a8878,
    skyColor: 0x0c140e,
    skyTroughColor: 0x303840,
    plantPeakColor: 0x3fae5a,
    plantTroughColor: 0x9a7b4d,
    herbivore: {
        kind: "herbivore",
        name: "Herbivore",
        color: 0xd7f05a,
        speed: 2.0,
        maxTurn: 1.1,
        senseRange: 14,
        eatRadius: 1.1,
        moveCost: 0.05,
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
        speed: 1.7,
        maxTurn: 1.3,
        senseRange: 10,
        eatRadius: 1.2,
        moveCost: 0.18,
        turnCost: 0.8,
        maxEnergy: 100,
        reproduceEnergy: 130,
        reproduceCost: 105,
        litterSize: 1,
        maxAge: 1200,
        foodEnergy: 8,
    },
    plants: { regrowPerTick: 1, energy: 18, maxPlants: 500 },
};

/** Ice age — cold, sparse, low energy throughput. Plants are scarcer and
 * lower-yield; herbivores need to travel further for less food; carnivores
 * get a slightly higher catch chance to keep the predator population viable
 * in a low-prey world.
 */
export const iceAgeEra: EraConfig = {
    name: "Ice Age",
    groundColor: 0x7a7a6e,
    groundTroughColor: 0x5a5a52,
    skyColor: 0x303840,
    skyTroughColor: 0x1a2228,
    plantPeakColor: 0x6a8a6a,
    plantTroughColor: 0x5a5a52,
    herbivore: {
        kind: "herbivore",
        name: "Herbivore",
        color: 0xb5c89a,
        speed: 2.2,
        maxTurn: 1.0,
        senseRange: 18,
        eatRadius: 1.0,
        moveCost: 0.06,
        turnCost: 1.0,
        maxEnergy: 90,
        reproduceEnergy: 80,
        reproduceCost: 55,
        litterSize: 1,
        maxAge: 1400,
        foodEnergy: 9,
    },
    carnivore: {
        kind: "carnivore",
        name: "Carnivore",
        color: 0x9a4a4a,
        speed: 1.9,
        maxTurn: 1.2,
        senseRange: 12,
        eatRadius: 1.3,
        moveCost: 0.18,
        turnCost: 0.8,
        maxEnergy: 100,
        reproduceEnergy: 120,
        reproduceCost: 100,
        litterSize: 1,
        maxAge: 1100,
        foodEnergy: 9,
    },
    plants: { regrowPerTick: 0.8, energy: 16, maxPlants: 420 },
};
