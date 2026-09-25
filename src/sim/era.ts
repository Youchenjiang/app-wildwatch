/** Era presets for the scenario milestone: each era redefines the biome palette
 * and can nudge species parameters so the same evolutionary engine plays out
 * differently on grassland, ice age, desert, etc.
 *
 * An era is declarative — it names the look and the selective pressures, and
 * the world mesh/atmosphere builders and the species seeding derive their
 * values from it. Runs that omit an era default to grassland.
 */
import type { SpeciesParams } from "./types";
import { SPECIES } from "./species";

/** How an era reshapes one species: a partial overlay on the base SpeciesParams.
 * Missing keys keep the base value. This keeps era presets small — only the
 * parameters that actually differ from grassland are listed.
 */
export type SpeciesOverlay = Partial<SpeciesParams>;

/** Per-era plant defaults (the seeding's plantRegrowPerTick / plantEnergy /
 * maxPlants can all be era-specific). The vegetation cycle length and trough
 * depth are era-specific too: a desert has long, deep droughts while a
 * grassland breathes with a shallow, quicker season.
 */
export interface PlantOverlay {
    regrowPerTick?: number;
    energy?: number;
    maxPlants?: number;
    /** Ticks per seasonal plant cycle; 0 disables seasons. */
    seasonLength?: number;
    /** 0..1 seasonal trough depth: 1 starves plants fully. */
    seasonDepth?: number;
}

/** Per-era starting population: an era's energy throughput determines how
 * many founders it can support, so the counts belong to the era, not to a
 * generic default. Values omitted fall back to the shared seeding defaults.
 */
export interface SeedingOverlay {
    herbivoreCount?: number;
    carnivoreCount?: number;
    plantCount?: number;
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
    /** Starting population chosen and validated for this era's throughput. */
    seeding?: SeedingOverlay;
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
    herbivore: SPECIES.herbivore,
    carnivore: SPECIES.carnivore,
    plants: { regrowPerTick: 1, energy: 18, maxPlants: 500, seasonLength: 3000, seasonDepth: 0.5 },
    // The validated baseline seeding (see tests/balance-probe.test.ts).
    seeding: { herbivoreCount: 60, carnivoreCount: 3, plantCount: 240 },
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
    herbivore: overlaySpecies(SPECIES.herbivore, {
        color: 0xb5c89a,
        speed: 2.2,
        maxTurn: 1.0,
        senseRange: 18,
        eatRadius: 3,
        moveCost: 0.06,
        maxEnergy: 90,
        reproduceEnergy: 80,
        reproduceCost: 55,
        maxAge: 1400,
        foodEnergy: 9,
    }),
    carnivore: overlaySpecies(SPECIES.carnivore, {
        color: 0x9a4a4a,
        speed: 1.9,
        maxTurn: 1.2,
        senseRange: 12,
        eatRadius: 4,
        reproduceEnergy: 120,
        reproduceCost: 100,
        maxAge: 1100,
        foodEnergy: 9,
    }),
    // A slower, shallower cycle than grassland: in a glaciated world scarcity
    // is steady rather than boom-and-bust, so the trough must not bite deeply
    // enough to crash the herbivores (validated by the era balance sweep).
    plants: { regrowPerTick: 0.8, energy: 16, maxPlants: 420, seasonLength: 3400, seasonDepth: 0.4 },
    // One founder predator: three over-hunts the sparser prey base before the
    // herbivores can establish (validated by the era balance sweep).
    seeding: { carnivoreCount: 1 },
};

/** Desert — hot, sparse and feast-or-famine. Plants are rare and low-yield on
 * average but each one is energy-dense, so herbivores must range far and
 * endure long droughts between blooms; carnivores are lean endurance runners.
 */
export const desertEra: EraConfig = {
    name: "Desert",
    groundColor: 0xbb9a63,
    groundTroughColor: 0x8a7a5c,
    skyColor: 0x3a2a1a,
    skyTroughColor: 0xa08e6e,
    plantPeakColor: 0x8fae52,
    plantTroughColor: 0x9a8544,
    herbivore: overlaySpecies(SPECIES.herbivore, {
        color: 0xe8d27a,
        speed: 2.2,
        maxTurn: 1.2,
        senseRange: 20,
        eatRadius: 3,
        moveCost: 0.06,
        maxEnergy: 95,
        maxAge: 1500,
        foodEnergy: 14,
    }),
    carnivore: overlaySpecies(SPECIES.carnivore, {
        color: 0xb85a3a,
        speed: 1.9,
        senseRange: 14,
        /**
         * Longer than the grassland predator's 4: this world is sparse, so
         * encounters are rarer and a hunt that only lands at point-blank range
         * never pays for itself. Measured — at 4 the predator line starves out
         * around tick 22,000 with the herbivores left at 78.
         */
        eatRadius: 5,
        moveCost: 0.16,
        reproduceEnergy: 120,
        reproduceCost: 100,
        maxAge: 1100,
        foodEnergy: 9,
    }),
    plants: { regrowPerTick: 0.55, energy: 26, maxPlants: 340, seasonLength: 5000, seasonDepth: 0.6 },
};
