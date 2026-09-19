/**
 * Uniform-grid spatial hash.
 *
 * The world rebuilds it every tick and then queries "what is near me" in O(1)
 * buckets instead of scanning the whole population every time.
 */

export class SpatialGrid<T> {
    private readonly cells = new Map<number, T[]>();

    constructor(private readonly cellSize: number) {}

    private key(cx: number, cy: number): number {
        return (cx * 73856093) ^ (cy * 19349663);
    }

    clear(): void {
        this.cells.clear();
    }

    insert(x: number, y: number, item: T): void {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        const key = this.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
        }
        bucket.push(item);
    }

    /** Appends every item whose cell intersects the circle at (x, y, radius). */
    query(x: number, y: number, radius: number, out: T[]): void {
        const r = Math.max(0, radius);
        const minCX = Math.floor((x - r) / this.cellSize);
        const maxCX = Math.floor((x + r) / this.cellSize);
        const minCY = Math.floor((y - r) / this.cellSize);
        const maxCY = Math.floor((y + r) / this.cellSize);
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cy = minCY; cy <= maxCY; cy++) {
                const bucket = this.cells.get(this.key(cx, cy));
                if (bucket) out.push(...bucket);
            }
        }
    }
}