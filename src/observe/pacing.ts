/**
 * Observation pacing: how fast the world is allowed to advance in wall-clock
 * time. This is a lens, like the rest of the observation rig — it decides when
 * ticks happen, never what they do, so the tick sequence is untouched.
 *
 * The speed is expressed in ticks per second rather than ticks per frame,
 * because a per-frame knob cannot go slower than one tick every frame while
 * still advancing at all. At 60 fps that floor is 60 ticks a second — over half
 * a turn (a turn is 100 ticks) — which is far too fast to watch a single animal
 * steer. Time-based speeds need an accumulator: a slow setting runs no tick on
 * most frames and one tick when enough time has collected.
 *
 * It also stops the speed from depending on the display: the same setting now
 * advances the same number of ticks per second whether the screen refreshes at
 * 60 Hz or 120 Hz.
 */

/** The observation speeds a player can step through, in ticks per second. */
export const SPEED_STEPS: readonly number[] = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 4000,
];

/** Where a run starts: about what 10 ticks per frame used to give at 60 fps. */
export const DEFAULT_TICKS_PER_SECOND = 500;

/**
 * The most ticks one frame may run. Only reachable when the frame clock stalls
 * — a backgrounded tab, a long GC pause — and it exists so the world cannot
 * fast-forward through everything that "would" have happened while nothing was
 * being drawn. Backlog beyond this is dropped, not paid off later.
 */
export const MAX_TICKS_PER_FRAME = 240;

/** How the frame loop should advance the world this frame. */
export interface TickAdvance {
    /** Whole ticks to run now. */
    ticks: number;
    /** Leftover time, in ticks, carried into the next frame. */
    carry: number;
}

/**
 * Accumulate elapsed time into whole ticks.
 *
 * `carry` is measured in ticks (not seconds) so no rate conversion is needed
 * per frame. At the slow end it is the whole mechanism: 5 ticks per second at
 * 60 fps adds 0.083 a frame, so nineteen frames pass before one tick runs.
 */
export function advanceTicks(carry: number, ticksPerSecond: number, dtSeconds: number): TickAdvance {
    const wanted = carry + Math.max(0, dtSeconds) * Math.max(0, ticksPerSecond);
    const ticks = Math.min(Math.floor(wanted), MAX_TICKS_PER_FRAME);
    // Normally `wanted - ticks` is already below one; only the cap can leave a
    // bigger remainder, and keeping that would turn one stall into a burst.
    return { ticks, carry: Math.min(wanted - ticks, 1) };
}

/** The speed as shown on the control bar, in the unit being chosen. */
export function speedLabel(ticksPerSecond: number): string {
    return `${ticksPerSecond}/s`;
}
