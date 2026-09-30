import { describe, expect, it } from "vitest";
import rawGodMemory from "../public/data/god-memory.json";
import { Brain } from "../src/sim/brain";
import type { GodMemory } from "../src/sim/types";

describe("God Memory Schema & Asset", () => {
    const godMemory = rawGodMemory as unknown as GodMemory;

    it("has valid metadata and eons", () => {
        expect(godMemory.version).toBe("1.0.0");
        expect(godMemory.eons).toBeGreaterThanOrEqual(1);
        expect(new Date(godMemory.updatedAt).getTime()).not.toBeNaN();
    });

    it("has valid policy parameters", () => {
        const { policy } = godMemory;
        expect(policy.rainPreyThreshold).toBeGreaterThan(0);
        expect(policy.blightPredatorThreshold).toBeGreaterThan(policy.rainPreyThreshold);
        expect(policy.interventionCooldown).toBeGreaterThan(0);
        expect(policy.socialTendency).toBeGreaterThanOrEqual(0);
        expect(policy.socialTendency).toBeLessThanOrEqual(1);
    });

    it("has valid sacred seeds with exact dimension matching BrainSpec", () => {
        for (const kind of ["herbivore", "carnivore"] as const) {
            const seed = godMemory.sacredSeeds[kind];
            expect(seed.species).toBe(kind);
            expect(seed.fitness).toBeGreaterThan(0);

            const { inputSize, hiddenSize, outputSize } = seed.spec;
            expect(inputSize).toBe(11);
            expect(hiddenSize).toBe(5);
            expect(outputSize).toBe(2);

            const { w1, b1, w2, b2 } = seed.weights;
            expect(w1.length).toBe(inputSize * hiddenSize);
            expect(b1.length).toBe(hiddenSize);
            expect(w2.length).toBe(hiddenSize * outputSize);
            expect(b2.length).toBe(outputSize);

            // Reconstruct Brain instance and ensure non-NaN forward pass
            const brain = new Brain(
                seed.spec,
                new Float32Array(w1),
                new Float32Array(b1),
                new Float32Array(w2),
                new Float32Array(b2),
            );

            const dummyInput = new Array(inputSize).fill(0.5);
            const output = brain.forward(dummyInput);
            expect(output.length).toBe(outputSize);
            for (let i = 0; i < outputSize; i++) {
                expect(Number.isFinite(output[i])).toBe(true);
                expect(Number.isNaN(output[i])).toBe(false);
            }
        }
    });
});
