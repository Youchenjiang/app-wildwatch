import { Brain } from "./brain";
import { DEFAULT_BRAIN_SPEC } from "./world";
import { gaussian, mulberry32 } from "./rng";
import type { GodMemory, GodPolicy, SacredSeed } from "./types";

/** Convert a serialized SacredSeed into a live, runnable Brain instance. */
export function sacredSeedToBrain(seed: SacredSeed): Brain {
    return new Brain(
        seed.spec,
        new Float32Array(seed.weights.w1),
        new Float32Array(seed.weights.b1),
        new Float32Array(seed.weights.w2),
        new Float32Array(seed.weights.b2),
    );
}

/** Fallback GodMemory synthesized deterministically when network/assets are unavailable. */
export function createDefaultGodMemory(): GodMemory {
    const scale = 1 / Math.sqrt(DEFAULT_BRAIN_SPEC.inputSize);
    const makeWeights = (seedVal: number) => {
        const rng = mulberry32(seedVal);
        const w1 = Array.from(
            { length: DEFAULT_BRAIN_SPEC.inputSize * DEFAULT_BRAIN_SPEC.hiddenSize },
            () => Number((gaussian(rng) * scale).toFixed(5)),
        );
        const b1 = Array.from(
            { length: DEFAULT_BRAIN_SPEC.hiddenSize },
            () => Number((gaussian(rng) * scale * 0.1).toFixed(5)),
        );
        const w2 = Array.from(
            { length: DEFAULT_BRAIN_SPEC.hiddenSize * DEFAULT_BRAIN_SPEC.outputSize },
            () => Number((gaussian(rng) * scale).toFixed(5)),
        );
        const b2 = Array.from(
            { length: DEFAULT_BRAIN_SPEC.outputSize },
            () => Number((gaussian(rng) * scale * 0.1).toFixed(5)),
        );
        return { w1, b1, w2, b2 };
    };

    return {
        version: "1.0.0-fallback",
        updatedAt: new Date().toISOString(),
        eons: 1,
        sacredSeeds: {
            herbivore: {
                species: "herbivore",
                fitness: 1000,
                spec: DEFAULT_BRAIN_SPEC,
                weights: makeWeights(20260907),
            },
            carnivore: {
                species: "carnivore",
                fitness: 1500,
                spec: DEFAULT_BRAIN_SPEC,
                weights: makeWeights(20260908),
            },
        },
        policy: {
            rainPreyThreshold: 20,
            blightPredatorThreshold: 75,
            interventionCooldown: 1000,
            socialTendency: 0.5,
        } satisfies GodPolicy,
    };
}

/**
 * Loads the latest GodMemory from public static asset (e.g. GitHub Pages './data/god-memory.json').
 * Returns a fallback GodMemory if fetch is unsupported or fails.
 */
export async function loadGodMemory(url = "./data/god-memory.json"): Promise<GodMemory> {
    try {
        if (typeof fetch === "function") {
            const res = await fetch(url);
            if (res.ok) {
                const data = (await res.json()) as GodMemory;
                if (data?.sacredSeeds?.herbivore && data?.sacredSeeds?.carnivore) {
                    return data;
                }
            }
        }
    } catch {
        // Fall back gracefully on network or parse error
    }
    return createDefaultGodMemory();
}
