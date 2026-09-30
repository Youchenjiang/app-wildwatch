/**
 * Spatial acoustic and scent signal grid for collective / social intelligence.
 *
 * Provides two communication channels:
 * 1. Alarm Calls: Emitted by herbivores upon sighting predators. Warns nearby kin.
 * 2. Hunt Scents: Deposited by predators upon successful strikes. Attracts pack mates.
 */
export interface SignalVector {
    intensity: number;
    dx: number;
    dy: number;
}

export class SocialSignalGrid {
    private readonly w: number;
    private readonly h: number;
    private readonly cellsize: number;
    private readonly alarms: Float32Array;
    private readonly scents: Float32Array;

    constructor(width: number, height: number, cellsize = 6) {
        this.w = Math.max(1, Math.floor(width / cellsize));
        this.h = Math.max(1, Math.floor(height / cellsize));
        this.cellsize = cellsize;
        this.alarms = new Float32Array(this.w * this.h);
        this.scents = new Float32Array(this.w * this.h);
    }

    private cellIndex(x: number, y: number): number {
        const cx = Math.max(0, Math.min(this.w - 1, Math.floor(x / this.cellsize)));
        const cy = Math.max(0, Math.min(this.h - 1, Math.floor(y / this.cellsize)));
        return cy * this.w + cx;
    }

    emitAlarm(x: number, y: number, amount = 1.0): void {
        const idx = this.cellIndex(x, y);
        this.alarms[idx] = Math.min(5.0, this.alarms[idx] + amount);
    }

    depositScent(x: number, y: number, amount = 1.0): void {
        const idx = this.cellIndex(x, y);
        this.scents[idx] = Math.min(5.0, this.scents[idx] + amount);
    }

    queryAlarm(x: number, y: number, radius = 18): SignalVector | null {
        return this.querySignal(this.alarms, x, y, radius);
    }

    queryScent(x: number, y: number, radius = 24): SignalVector | null {
        return this.querySignal(this.scents, x, y, radius);
    }

    private querySignal(grid: Float32Array, x: number, y: number, radius: number): SignalVector | null {
        const minCX = Math.max(0, Math.floor((x - radius) / this.cellsize));
        const maxCX = Math.min(this.w - 1, Math.floor((x + radius) / this.cellsize));
        const minCY = Math.max(0, Math.floor((y - radius) / this.cellsize));
        const maxCY = Math.min(this.h - 1, Math.floor((y + radius) / this.cellsize));

        let maxVal = 0.05; // Noise floor
        let bestDX = 0;
        let bestDY = 0;

        for (let cy = minCY; cy <= maxCY; cy++) {
            for (let cx = minCX; cx <= maxCX; cx++) {
                const val = grid[cy * this.w + cx];
                if (val > maxVal) {
                    const cellCenterX = (cx + 0.5) * this.cellsize;
                    const cellCenterY = (cy + 0.5) * this.cellsize;
                    const dx = cellCenterX - x;
                    const dy = cellCenterY - y;
                    const d = Math.hypot(dx, dy);
                    if (d <= radius && d > 0.1) {
                        maxVal = val;
                        bestDX = dx / d;
                        bestDY = dy / d;
                    }
                }
            }
        }

        if (maxVal > 0.05) {
            return { intensity: maxVal, dx: bestDX, dy: bestDY };
        }
        return null;
    }

    /** Decay signal intensities over time (called each tick). */
    decay(decayRate = 0.05): void {
        const n = this.w * this.h;
        for (let i = 0; i < n; i++) {
            if (this.alarms[i] > 0.001) this.alarms[i] *= 1 - decayRate;
            else this.alarms[i] = 0;

            if (this.scents[i] > 0.001) this.scents[i] *= 1 - decayRate;
            else this.scents[i] = 0;
        }
    }
}
