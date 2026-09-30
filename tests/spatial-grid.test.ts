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
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 14, 5));
        grid.insert(item(3, 50, 50));

        const out: Item[] = [];
        grid.query(5, 5, 12, out);
        const ids = out.map((entry) => entry.id).sort();
        expect(ids).toEqual([1, 2]);
    });

    it("filters by true distance, not by which cells it scanned", () => {
        // Both items sit in cells the query has to scan, but only the nearer
        // one is inside the radius. This is the case the grid used to get
        // wrong: with a 10-unit cell, a caller asking for 1 unit was handed
        // whatever shared a cell with it.
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 9, 5));

        const near: Item[] = [];
        grid.query(5, 5, 1, near);
        expect(near.map((entry) => entry.id)).toEqual([1]);

        const wider: Item[] = [];
        grid.query(5, 5, 4, wider);
        expect(wider.map((entry) => entry.id).sort()).toEqual([1, 2]);
    });

    it("includes an item exactly on the radius", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 3, 0));
        const out: Item[] = [];
        grid.query(0, 0, 3, out);
        expect(out.map((entry) => entry.id)).toEqual([1]);
    });

    it("returns only coincident items for a zero or negative radius", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 5, 5));
        grid.insert(item(2, 5.5, 5));

        const zero: Item[] = [];
        grid.query(5, 5, 0, zero);
        expect(zero.map((entry) => entry.id)).toEqual([1]);

        // A negative radius clamps to zero rather than inverting the test.
        const negative: Item[] = [];
        grid.query(5, 5, -1, negative);
        expect(negative.map((entry) => entry.id)).toEqual([1]);
    });

    it("ignores items in a cell the radius does not reach", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 1, 1));
        grid.insert(item(2, 95, 95));

        const out: Item[] = [];
        grid.query(1, 1, 5, out);
        expect(out.map((entry) => entry.id)).toEqual([1]);
    });

    it("files an item by the same position it measures it by", () => {
        // There is no coordinate argument to disagree with the accessor, so an
        // item is filed where the accessor says it is and found there, even
        // though no caller ever names that position.
        const grid = new SpatialGrid<Nested>(10, (nested) => nested.pos);
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

    it("re-files an item that crosses into another cell and leaves nothing behind", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const mover = item(1, 5, 5);
        grid.insert(mover);
        grid.insert(item(2, 6, 5));

        mover.x = 55;
        mover.y = 55;
        grid.update(mover);

        const here: Item[] = [];
        grid.query(5, 5, 5, here);
        expect(here.map((entry) => entry.id)).toEqual([2]);
        const there: Item[] = [];
        grid.query(55, 55, 5, there);
        expect(there.map((entry) => entry.id)).toEqual([1]);
        // The move must not have left a second copy in the old cell.
        expect(grid.size).toBe(2);
    });

    it("keeps filing order when a mover joins a cell", () => {
        // Order is simulation behaviour, not bookkeeping: query hands items
        // back in this order and a scavenger eats the first corpse it is
        // handed. A rebuild ordered a cell by creation, so a mover must slot in
        // by creation and not by arrival.
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const first = item(1, 5, 5);
        const second = item(2, 6, 5);
        const third = item(3, 7, 5);
        grid.insert(first);
        grid.insert(second);
        grid.insert(third);

        // Send the youngest away, then send the oldest after it: arrival order
        // is 3 then 1, creation order is 1 then 3.
        third.x = 55;
        third.y = 55;
        grid.update(third);
        first.x = 55;
        first.y = 55;
        grid.update(first);

        const out: Item[] = [];
        grid.query(55, 55, 5, out);
        expect(out.map((entry) => entry.id)).toEqual([1, 3]);
    });

    it("does no work for an item that stayed in its cell", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const alpha = item(1, 5, 5);
        const beta = item(2, 6, 5);
        grid.insert(alpha);
        grid.insert(beta);

        // A small move inside the same cell, the common case every tick.
        alpha.x = 7;
        alpha.y = 8;
        grid.update(alpha);

        const out: Item[] = [];
        grid.query(5, 5, 5, out);
        expect(out.map((entry) => entry.id)).toEqual([1, 2]);
        expect(grid.size).toBe(2);
        expect(grid.has(alpha)).toBe(true);
    });

    it("files an entry that update sees for the first time", () => {
        // How a newborn enters the index: update is called on it at the sync
        // point rather than at birth, so insert-on-first-sight is the contract.
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const late = item(9, 5, 5);
        expect(grid.has(late)).toBe(false);
        grid.update(late);
        expect(grid.has(late)).toBe(true);
        const out: Item[] = [];
        grid.query(5, 5, 1, out);
        expect(out.map((entry) => entry.id)).toEqual([9]);
    });

    it("unhooks a removed item and keeps the order of the rest", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const first = item(1, 5, 5);
        const second = item(2, 5.5, 5);
        const third = item(3, 6, 5);
        grid.insert(first);
        grid.insert(second);
        grid.insert(third);

        grid.remove(second);
        expect(grid.size).toBe(2);
        expect(grid.has(second)).toBe(false);

        const out: Item[] = [];
        grid.query(5, 5, 5, out);
        expect(out.map((entry) => entry.id)).toEqual([1, 3]);

        // Removing twice, or removing something never filed, is harmless.
        grid.remove(second);
        grid.remove(item(99, 0, 0));
        expect(grid.size).toBe(2);
    });

    it("ignores a second insert of the same item", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        const duplicate = item(1, 5, 5);
        grid.insert(duplicate);
        grid.insert(duplicate);
        expect(grid.size).toBe(1);
        const out: Item[] = [];
        grid.query(5, 5, 1, out);
        expect(out.map((entry) => entry.id)).toEqual([1]);
    });

    it("clear removes everything", () => {
        const grid = new SpatialGrid<Item>(10, (entry) => entry);
        grid.insert(item(1, 1, 1));
        grid.clear();
        const out: Item[] = [];
        grid.query(1, 1, 100, out);
        expect(out).toHaveLength(0);
    });
});
