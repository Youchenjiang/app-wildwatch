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
        const grid = new SpatialGrid<Item>(10);
        grid.insert(5, 5, item(1, 5, 5));
        grid.insert(14, 5, item(2, 14, 5));
        grid.insert(50, 50, item(3, 50, 50));

        const out: Item[] = [];
        grid.query(5, 5, 12, out);
        const ids = out.map((i) => i.id).sort();
        expect(ids).toEqual([1, 2]);
    });

    it("clear removes everything", () => {
        const grid = new SpatialGrid<Item>(10);
        grid.insert(1, 1, item(1, 1, 1));
        grid.clear();
        const out: Item[] = [];
        grid.query(1, 1, 100, out);
        expect(out).toHaveLength(0);
    });
});