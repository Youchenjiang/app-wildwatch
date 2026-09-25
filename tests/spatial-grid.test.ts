import { describe, expect, it } from "vitest";
import { SpatialGrid } from "../src/sim/spatial-grid";

interface Item {
    id: number;
    x: number;
    y: number;
}

/** An item whose position is not at the top level, like an Entity's `pos`. */
interface Nested {
    id: number;
    pos: { x: number; y: number };
}

const item = (id: number, x: number, y: number): Item => ({ id, x, y });

describe("SpatialGrid", () => {
    it("returns only items within the query radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 14, 5));
        grid.insert(item(3, 50, 50));

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
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 9, 5));

        const near: Item[] = [];
        grid.query(5, 5, 1, near);
        expect(near.map((i) => i.id)).toEqual([1]);

        const wider: Item[] = [];
        grid.query(5, 5, 4, wider);
        expect(wider.map((i) => i.id).sort()).toEqual([1, 2]);
    });

    it("includes an item exactly on the radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(item(1, 3, 0));
        const out: Item[] = [];
        grid.query(0, 0, 3, out);
        expect(out.map((i) => i.id)).toEqual([1]);
    });

    it("returns only coincident items for a zero or negative radius", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 5.5, 5));

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
        grid.insert(item(1, 1, 1));
        grid.insert(item(2, 95, 95));

        const out: Item[] = [];
        grid.query(1, 1, 5, out);
        expect(out.map((i) => i.id)).toEqual([1]);
    });

    it("files an item by the same position it measures it by", () => {
        // There is no coordinate argument to disagree with the accessor, so an
        // item is filed where the accessor says it is and found there, even
        // though no caller ever names that position.
        const grid = new SpatialGrid<Nested>(10, (n) => n.pos);
        const subject: Nested = { id: 1, pos: { x: 25, y: 25 } };
        grid.insert(subject);

        const here: Nested[] = [];
        grid.query(25, 25, 0, here);
        expect(here).toEqual([subject]);

        // Its own cell (25,25), not the origin or any other place a caller
        // might have believed it was filed.
        const elsewhere: Nested[] = [];
        grid.query(0, 0, 5, elsewhere);
        expect(elsewhere).toHaveLength(0);
    });

    it("clear removes everything", () => {
        const grid = new SpatialGrid<Item>(10, (i) => i);
        grid.insert(item(1, 1, 1));
        grid.clear();
        const out: Item[] = [];
        grid.query(1, 1, 100, out);
        expect(out).toHaveLength(0);
    });
});
