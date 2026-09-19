import { describe, expect, it } from "vitest";
import { Brain, type BrainSpec } from "../src/sim/brain";
import { mulberry32 } from "../src/sim/rng";

const SPEC: BrainSpec = { inputSize: 3, hiddenSize: 4, outputSize: 2 };

describe("Brain", () => {
    it("produces outputs of the expected shape", () => {
        const brain = Brain.random(SPEC, mulberry32(1));
        const out = brain.forward([1, 0, 0.5]);
        expect(out).toHaveLength(2);
        expect(Math.abs(out[0])).toBeLessThanOrEqual(1);
        expect(Math.abs(out[1])).toBeLessThanOrEqual(1);
    });

    it("is deterministic under the same seed", () => {
        const a = Brain.random(SPEC, mulberry32(7));
        const b = Brain.random(SPEC, mulberry32(7));
        expect(Array.from(a.w1)).toEqual(Array.from(b.w1));
        expect(Array.from(a.b2)).toEqual(Array.from(b.b2));
    });

    it("mutation changes weights", () => {
        const brain = Brain.random(SPEC, mulberry32(3));
        const before = Array.from(brain.w1);
        brain.mutate(1, 0.5, mulberry32(9));
        expect(Array.from(brain.w1)).not.toEqual(before);
    });

    it("clone is independent of the original", () => {
        const brain = Brain.random(SPEC, mulberry32(5));
        const clone = brain.clone();
        clone.w1[0] = 99;
        expect(brain.w1[0]).not.toBe(99);
    });

    it("crossover mixes weights from both parents", () => {
        const a = Brain.random(SPEC, mulberry32(11));
        const b = Brain.random(SPEC, mulberry32(22));
        const child = a.crossover(b, mulberry32(33));
        expect(child.spec).toBe(SPEC);
        expect(child.w1).toHaveLength(SPEC.inputSize * SPEC.hiddenSize);

        let fromA = 0;
        let fromB = 0;
        for (let i = 0; i < child.w1.length; i++) {
            if (child.w1[i] === a.w1[i]) fromA++;
            if (child.w1[i] === b.w1[i]) fromB++;
        }
        expect(fromA).toBeGreaterThan(0);
        expect(fromB).toBeGreaterThan(0);
    });

    it("crossover leaves both parents untouched", () => {
        const a = Brain.random(SPEC, mulberry32(44));
        const b = Brain.random(SPEC, mulberry32(55));
        const beforeA = Array.from(a.w1);
        const beforeB = Array.from(b.w1);
        a.crossover(b, mulberry32(66));
        expect(Array.from(a.w1)).toEqual(beforeA);
        expect(Array.from(b.w1)).toEqual(beforeB);
    });
});