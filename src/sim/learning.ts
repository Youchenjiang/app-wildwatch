/** Spatial life-count grid — warms-up foraging heuristics per era.

 * Counts how many entity-ticks have been spent in each cell across the
 * population, smoothed by age so recently dead regions still feel alive for
 * a short while. Consumers use this as a cheap "is this region productive"
 * prior before committing to long moves.
 *
 * The grid is owned by the World (or a scenario) each turn so that learning
 * is scoped per era — which lines up with the eventual scenario-transition
 * system.
 */
export class LifeGrid {
    private readonly counts: Float32Array;
    private readonly w: number;
    private readonly h: number;
    private readonly cellsize: number;

    constructor(width: number, height: number, cellsize = 6) {
        this.w = Math.max(1, Math.floor(width / cellsize));
        this.h = Math.max(1, Math.floor(height / cellsize));
        this.cellsize = cellsize;
        this.counts = new Float32Array(this.w * this.h);
    }

    /** Emit every cell that overlaps the circle at (x, y, radius). */
    query(x: number, y: number, radius: number, out: { cx: number; cy: number; value: number }[]): void {
        if (radius <= 0 || out.length >= 256) return;
        const minCX = Math.max(0, Math.floor((x - radius) / this.cellsize));
        const maxCX = Math.min(this.w - 1, Math.floor((x + radius) / this.cellsize));
        const minCY = Math.max(0, Math.floor((y - radius) / this.cellsize));
        const maxCY = Math.min(this.h - 1, Math.floor((y + radius) / this.cellsize));
        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const i = cy * this.w + cx;
                out.push({ cx, cy, value: this.counts[i] });
            }
        }
    }

    /** Increment the count for every cell an entity overlaps this tick. */
    record(x: number, y: number, delta = 1): void {
        const cx = Math.max(0, Math.min(this.w - 1, Math.floor(x / this.cellsize)));
        const cy = Math.max(0, Math.min(this.h - 1, Math.floor(y / this.cellsize)));
        this.counts[cy * this.w + cx] += delta;
    }

    /** Smooth the grid once per turn: decay every bucket by `decay`. */
    decay(decay: number, cap: number): void {
        const n = this.counts.length;
        const tmp = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const v = this.counts[i] * (1 - decay);
            tmp[i] = Math.min(cap, v);
        }
        this.counts.set(tmp);
    }

    idx(cx: number, cy: number): number {
        cx = Math.max(0, Math.min(this.w - 1, cx));
        cy = Math.max(0, Math.min(this.h - 1, cy));
        return cy * this.w + cx;
    }
}