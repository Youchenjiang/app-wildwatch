/**
 * Uniform-grid spatial hash.
 *
 * The world rebuilds it every tick and then queries "what is near me" in O(1)
 * buckets instead of scanning the whole population every time.
 *
 * `query` enforces the radius it is given as a real distance. It used to append
 * every item in each overlapped cell, which meant a radius only chose *which
 * cells* to scan: with a 10-unit cell, a caller asking for 1.1 units could
 * still be handed an item ~10 units away. Callers then picked the nearest
 * candidate without ever comparing it to their radius, so every reach in the
 * simulation was effectively a cell boundary rather than the value in the
 * species parameters. Filtering here fixes all of them at once, and also makes
 * a key collision between two distant cells harmless, since a colliding item
 * can no longer pass the distance test.
 *
 * The same accessor decides both the cell an item is filed in and the distance
 * it is measured by, so the two can never disagree. That is why `insert` takes
 * only the item: a separate coordinate argument would let a caller file a thing
 * where it used to be and then have a query measure it where it is now, and
 * every item would silently vanish from its own neighbourhood.
 */

export interface Positioned {
    x: number;
    y: number;
}

export class SpatialGrid<T> {
    private readonly cells = new Map<number, T[]>();

    constructor(
        private readonly cellSize: number,
        /** Where an item actually is. Entity keeps its position under `pos`. */
        private readonly position: (item: T) => Positioned,
    ) {}

    private key(cx: number, cy: number): number {
        return (cx * 73856093) ^ (cy * 19349663);
    }

    clear(): void {
        this.cells.clear();
    }

    insert(item: T): void {
        const p = this.position(item);
        const cx = Math.floor(p.x / this.cellSize);
        const cy = Math.floor(p.y / this.cellSize);
        const key = this.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
        }
        bucket.push(item);
    }

    /**
     * Append every item within `radius` of (x, y), inclusive of the boundary so
     * an item exactly at the reach is still reachable.
     */
    query(x: number, y: number, radius: number, out: T[]): void {
        const r = Math.max(0, radius);
        const r2 = r * r;
        const minCX = Math.floor((x - r) / this.cellSize);
        const maxCX = Math.floor((x + r) / this.cellSize);
        const minCY = Math.floor((y - r) / this.cellSize);
        const maxCY = Math.floor((y + r) / this.cellSize);
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const bucket = this.cells.get(this.key(cx, cy));
                if (!bucket) continue;
                for (const item of bucket) {
                    const p = this.position(item);
                    const dx = p.x - x;
                    const dy = p.y - y;
                    if (dx * dx + dy * dy <= r2) out.push(item);
                }
            }
        }
    }
}
