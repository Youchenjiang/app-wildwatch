/**
 * Uniform-grid spatial hash.
 *
 * The world keeps one of these per kind of thing and queries "what is near me"
 * in O(1) buckets instead of scanning the whole population every time.
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
 *
 * It is maintained in place rather than rebuilt. The world used to clear and
 * refill every index each tick, which cost time proportional to the whole
 * population on every tick even though only a few things change — measured at
 * ~35ns per item, so ~3% of a tick at today's ~120 items but ~16% once the
 * populations reach the caps. Now an item is filed once, re-filed only when it
 * actually crosses into another cell, and unhooked when it dies.
 */

export interface Positioned {
    x: number;
    y: number;
}

/** What the grid remembers about each filed item. */
interface Filed {
    /** The bucket it is in. */
    key: number;
    /** Its slot in that bucket, kept current so removal is not a search. */
    index: number;
    /** When it was first filed, which decides its place among its neighbours. */
    seq: number;
}

export class SpatialGrid<T> {
    private readonly cells = new Map<number, T[]>();
    /** Reverse index over `cells`, so an item can be moved or dropped directly. */
    private readonly filed = new Map<T, Filed>();
    private nextSequence = 0;

    constructor(
        private readonly cellSize: number,
        /** Where an item actually is. Entity keeps its position under `pos`. */
        private readonly position: (item: T) => Positioned,
    ) {}

    /** How many items are currently filed. */
    get size(): number {
        return this.filed.size;
    }

    /** True if the item is currently filed. */
    has(item: T): boolean {
        return this.filed.has(item);
    }

    private key(cx: number, cy: number): number {
        return (cx * 73856093) ^ (cy * 19349663);
    }

    private keyOf(p: Positioned): number {
        return this.key(Math.floor(p.x / this.cellSize), Math.floor(p.y / this.cellSize));
    }

    clear(): void {
        this.cells.clear();
        this.filed.clear();
    }

    /**
     * Append every item within `radius` of (x, y), inclusive of the boundary
     * so an item exactly at the reach is still reachable.
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
                    const pos = this.position(item);
                    const dx = pos.x - x;
                    const dy = pos.y - y;
                    if (dx * dx + dy * dy <= r2) out.push(item);
                }
            }
        }
    }

    /** File an item for the first time. Filing it twice is a no-op. */
    insert(item: T): void {
        if (this.filed.has(item)) return;
        this.place(item, this.keyOf(this.position(item)), this.nextSequence++);
    }

    /**
     * Bring one item's filing up to date: file it if it is new, re-file it if
     * it has crossed into another cell, and do nothing otherwise.
     *
     * Doing nothing is the common case and the point of the whole arrangement.
     * An animal travels about 2 units a tick in a 10-unit cell, so most ticks
     * move nothing in the index at all, where a rebuild moved everything.
     */
    update(item: T): void {
        const entry = this.filed.get(item);
        if (!entry) {
            this.insert(item);
            return;
        }
        const key = this.keyOf(this.position(item));
        if (key === entry.key) return;
        this.detach(item, entry);
        this.place(item, key, entry.seq);
    }

    /** Unhook an item that has left the world. Unfiled items are ignored. */
    remove(item: T): void {
        const entry = this.filed.get(item);
        if (entry) this.detach(item, entry);
    }

    /**
     * Put an item in a bucket, keeping the bucket in filing order.
     *
     * The order is behaviour, not bookkeeping: `query` hands items back in
     * bucket order, and a scavenger eats the *first* corpse it is handed rather
     * than the nearest. Filing order is creation order for anything inserted
     * once, so keeping buckets sorted by it reproduces exactly what rebuilding
     * every tick produced. A new item has the highest sequence there is, so the
     * search below stops immediately and this is an append.
     */
    private place(item: T, key: number, seq: number): void {
        let bucket = this.cells.get(key);
        if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
        }
        let at = bucket.length;
        while (at > 0) {
            const previous = this.filed.get(bucket[at - 1]);
            if (!previous || previous.seq <= seq) {
                break;
            }
            at--;
        }
        this.filed.set(item, { key, index: at, seq });
        bucket.splice(at, 0, item);
        for (let slot = at; slot < bucket.length; slot++) {
            const existing = this.filed.get(bucket[slot]);
            if (existing) {
                existing.index = slot;
            }
        }
    }

    /** Take an item out of its bucket, leaving the order of the rest intact. */
    private detach(item: T, entry: Filed): void {
        const bucket = this.cells.get(entry.key);
        if (bucket) {
            bucket.splice(entry.index, 1);
            for (let slot = entry.index; slot < bucket.length; slot++) {
                const existing = this.filed.get(bucket[slot]);
                if (existing) {
                    existing.index = slot;
                }
            }
            if (bucket.length === 0) this.cells.delete(entry.key);
        }
        this.filed.delete(item);
    }
}
