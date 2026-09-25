import { describe, expect, it } from "vitest";
import { cosineSimilarity, createMemory } from "../src/sim/memory";

describe("Memory", () => {
    it("records episodes and recalls them by cosine similarity", () => {
        const m = createMemory(8);
        m.record([1, 0, 0, 0, 0, 0], 0.2, 10, 5);
        m.record([0, 1, 0, 0, 0, 0], -0.2, 8, 6);

        const found = m.recall([1, 0, 0, 0, 0, 0], 2);
        expect(found).toHaveLength(2);
        expect(found[0].similarity).toBeCloseTo(1, 5);
        expect(found[0].episode.reward).toBe(10);
    });

    it("returns fewer results than the trace count when limit is small", () => {
        const m = createMemory(8);
        for (let i = 0; i < 5; i++) {
            m.record([i % 3, 0, 0, 0, 0, 0], 0, 1, i);
        }
        expect(m.recall([1, 0, 0, 0, 0, 0], 2)).toHaveLength(2);
    });

    it("evicts the oldest trace when capacity is exceeded", () => {
        const m = createMemory(3);
        m.record([1, 0, 0, 0, 0, 0], 0, 1, 1);
        m.record([0, 1, 0, 0, 0, 0], 0, 1, 2);
        m.record([0, 0, 1, 0, 0, 0], 0, 1, 3);
        m.record([0, 0, 0, 1, 0, 0], 0, 1, 4);

        // oldest should be gone
        const found = m.recall([1, 0, 0, 0, 0, 0], 4);
        expect(found).toHaveLength(3);
        expect(found.some((f) => f.episode.reward === 1 && f.episode.age === 1)).toBe(false);
    });

    it("discards stale traces in age()", () => {
        const m = createMemory(8);
        m.record([1, 0, 0, 0, 0, 0], 0, 1, 10);
        m.record([0, 1, 0, 0, 0, 0], 0, 1, 50);
        m.age(250);
        const found = m.recall([1, 0, 0, 0, 0, 0], 4);
        expect(found).toHaveLength(1);
        expect(found[0].episode.age).toBe(50);
    });

    it("size reflects recorded traces", () => {
        const m = createMemory(4);
        expect(m.size()).toBe(0);
        m.record([1, 0, 0, 0, 0, 0], 0, 1, 1);
        m.record([0, 1, 0, 0, 0, 0], 0, 1, 2);
        expect(m.size()).toBe(2);
    });

    it("recall limit trims results without mutating the memory", () => {
        const m = createMemory(8);
        m.record([1, 0, 0, 0, 0, 0], 0, 1, 1);
        m.record([0, 1, 0, 0, 0, 0], 0, 1, 2);
        const r1 = m.recall([1, 0, 0, 0, 0, 0], 1);
        expect(r1).toHaveLength(1);
        expect(m.size()).toBe(2);
    });

    it("recent returns the newest traces first, capped by limit", () => {
        const m = createMemory(8);
        m.record([1, 0, 0, 0, 0, 0], 0.1, 1, 1);
        m.record([0, 1, 0, 0, 0, 0], 0.2, 2, 2);
        m.record([0, 0, 1, 0, 0, 0], 0.3, 3, 3);

        expect(m.recent(2).map((e) => e.reward)).toEqual([3, 2]);
        expect(m.recent(10).map((e) => e.age)).toEqual([3, 2, 1]);
    });

    it("cosineSimilarity scores identical, orthogonal and opposite vectors", () => {
        expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
        expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
        expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 5);
        expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
        // Padding zeros on trace features must not change the score.
        expect(cosineSimilarity([1, 0], [1, 0, 0, 0])).toBeCloseTo(1, 5);
    });
});
