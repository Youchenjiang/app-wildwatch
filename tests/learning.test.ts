import { describe, expect, it } from "vitest";
import { LifeGrid } from "../src/sim/learning";

type Cell = { cx: number; cy: number; value: number };
const cells = (): Cell[] => [];

describe("LifeGrid", () => {
    it("records into the cell containing a point", () => {
        const g = new LifeGrid(60, 60, 10);
        g.record(5, 5, 1);
        const out = cells();
        g.query(5, 5, 1, out);
        expect(out).toHaveLength(1);
        expect(out[0].value).toBeCloseTo(1, 5);
    });

    it("queries only cells overlapping the radius", () => {
        const g = new LifeGrid(60, 60, 10);
        g.record(5, 5, 1);
        g.record(25, 5, 2);

        const near = cells();
        g.query(5, 5, 30, near);
        // The query returns every cell in the bounding box, including empty ones.
        const nonZero = near.map((c) => c.value).filter((v) => v > 0).sort();
        expect(nonZero).toEqual([1, 2]);
        expect(near.length).toBeGreaterThanOrEqual(2);
    });

    it("ignores queries with zero or negative radius", () => {
        const g = new LifeGrid(60, 60, 10);
        g.record(5, 5, 1);
        const out = cells();
        g.query(5, 5, 0, out);
        expect(out).toHaveLength(0);
        g.query(5, 5, -1, out);
        expect(out).toHaveLength(0);
    });

    it("clamps out-of-bounds points into the nearest cell", () => {
        const g = new LifeGrid(20, 20, 10);
        g.record(-5, -5, 1);
        g.record(100, 100, 1);
        const out = cells();
        g.query(0, 0, 10, out);
        const nonZero = out.map((c) => c.value).filter((v) => v > 0).sort();
        expect(nonZero).toEqual([1, 1]);
    });

    it("decays every bucket and respects the cap", () => {
        const g = new LifeGrid(20, 20, 10);
        g.record(5, 5, 10);
        g.decay(0.5, 6);
        const out = cells();
        g.query(5, 5, 1, out);
        expect(out[0].value).toBeCloseTo(5, 5);
    });

    it("caps values during decay", () => {
        const g = new LifeGrid(20, 20, 10);
        g.record(5, 5, 100);
        g.decay(0.1, 20);
        const out = cells();
        g.query(5, 5, 1, out);
        expect(out[0].value).toBeLessThanOrEqual(20);
    });

    it("idx clamps safely for manual lookups", () => {
        const g = new LifeGrid(20, 20, 10);
        expect(() => g.idx(-1, -1)).not.toThrow();
        expect(() => g.idx(100, 100)).not.toThrow();
    });
});
