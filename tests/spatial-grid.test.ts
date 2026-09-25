import { describe, expect, it } from "vitest";
import { SpatialGrid } from "../src/sim/spatial-grid";

interface Item {
    id: number;
    x: number;
    y: number;
}

const item = (id: number, x: number, y: number): Item => ({ id, x, y });

describe("SpatialGrid", () => {
    it("returns only items within the query radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(5, 5, item(1, 5, 5));
        grid.insert(14, 5, item(2, 14, 5));
        grid.insert(50, 50, item(3, 50, 50));

        const out: Item[] = [];
        grid.query(5, 5, 12, out);
        const ids = out.map((i) => i.id).sort();
        expect(ids).toEqual([1, 2]);
    });

    it("filters by true distance, not by which cells it scanned", () => {
        // Both items sit in cells the query has to scan, but only the nearer
        // one is inside the radius. This is the case the grid used to get
        // wrong: with a 10-unit cell, a caller asking for 1 unit was handed
        // whatever shared a cell with it.
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(5, 5, item(1, 5, 5));
        grid.insert(9, 5, item(2, 9, 5));

        const near: Item[] = [];
        grid.query(5, 5, 1, near);
        expect(near.map((i) => i.id)).toEqual([1]);

        const wider: Item[] = [];
        grid.query(5, 5, 4, wider);
        expect(wider.map((i) => i.id).sort()).toEqual([1, 2]);
    });

    it("includes an item exactly on the radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(3, 0, item(1, 3, 0));
        const out: Item[] = [];
        grid.query(0, 0, 3, out);
        expect(out.map((i) => i.id)).toEqual([1]);
    });

    it("returns only coincident items for a zero or negative radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(5, 5, item(1, 5, 5));
        grid.insert(5.5, 5, item(2, 5.5, 5));

        const zero: Item[] = [];
        grid.query(5, 5, 0, zero);
        expect(zero.map((i) => i.id)).toEqual([1]);

        // A negative radius clamps to zero rather than inverting the test.
        const negative: Item[] = [];
        grid.query(5, 5, -1, negative);
        expect(negative.map((i) => i.id)).toEqual([1]);
    });

    it("ignores items in a cell the radius does not reach", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(1, 1, item(1, 1, 1));
        grid.insert(95, 95, item(2, 95, 95));

        const out: Item[] = [];
        grid.query(1, 1, 5, out);
        expect(out.map((i) => i.id)).toEqual([1]);
    });

    it("clear removes everything", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(1, 1, item(1, 1, 1));
        grid.clear();
        const out: Item[] = [];
        grid.query(1, 1, 100, out);
        expect(out).toHaveLength(0);
    });
});
