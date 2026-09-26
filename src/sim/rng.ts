/**
 * Deterministic pseudo-random number generation.
 *
 * The whole simulation runs on seeded randomness so that a given seed always
 * reproduces the exact same evolution timeline — required for record/replay
 * and for unit tests.
 */

export type RNG = () => number;

/** mulberry32 — small, fast, good-enough distribution, fully deterministic. */
export function mulberry32(seed: number): RNG {
    let state = seed >>> 0;
    if (state === 0) state = 0x9e3779b9;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Uniform float in [min, max). */
export function randRange(rng: RNG, min: number, max: number): number {
    return min + rng() * (max - min);
}

/** Uniform integer in [min, maxExclusive). */
export function randInt(rng: RNG, min: number, maxExclusive: number): number {
    return min + Math.floor(rng() * (maxExclusive - min));
}

/** Random element of an array. */
export function pick<T>(rng: RNG, items: readonly T[]): T {
    return items[randInt(rng, 0, items.length)];
}

/** Standard normal sample via Box-Muller. Used for weight mutation. */
export function gaussian(rng: RNG): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}