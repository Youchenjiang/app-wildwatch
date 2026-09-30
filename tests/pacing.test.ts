import { describe, expect, it } from "vitest";
import {
    DEFAULT_TICKS_PER_SECOND,
    MAX_TICKS_PER_FRAME,
    SPEED_STEPS,
    advanceTicks,
    speedLabel,
} from "../src/observe/pacing";
import { makeSeeding } from "../src/sim/seeding";

/**
 * These use dt = 1/64 and tick rates that are dyadic, because every value a
 * tick accumulator touches is then exact in binary. A test that steps 1/60 of a
 * second at 10 ticks a second sits right on the boundary of "one tick", where
 * floating-point rounding decides the answer rather than the rule.
 */
const DT = 1 / 64;

/** Run `frames` frames and return the ticks per frame. */
function run(frames: number, ticksPerSecond: number, dt: number): number[] {
    const out: number[] = [];
    let carry = 0;
    for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
        const advance = advanceTicks(carry, ticksPerSecond, dt);
        carry = advance.carry;
        out.push(advance.ticks);
    }
    return out;
}

describe("observation pacing", () => {
    it("goes slow enough to watch one animal", () => {
        // A turn is 100 ticks. The floor used to be one tick per frame — 60
        // ticks a second — so a turn flashed past in under two seconds and the
        // observer had no speed at which behaviour could be followed.
        const slowest = SPEED_STEPS[0];
        const secondsPerTurn = makeSeeding().turnLength / slowest;
        expect(secondsPerTurn).toBeGreaterThanOrEqual(30);
    });

    it("keeps the fast end as fast as before", () => {
        // The old ceiling was 60 ticks per frame, about 3600 a second at 60 fps.
        expect(SPEED_STEPS[SPEED_STEPS.length - 1]).toBeGreaterThanOrEqual(3600);
    });

    it("is an ascending ladder with no repeats, and contains the default", () => {
        for (let stepIndex = 1; stepIndex < SPEED_STEPS.length; stepIndex++) {
            expect(SPEED_STEPS[stepIndex]).toBeGreaterThan(SPEED_STEPS[stepIndex - 1]);
        }
        expect(SPEED_STEPS).toContain(DEFAULT_TICKS_PER_SECOND);
    });

    it("holds a tick back until enough time has accumulated", () => {
        // 8 ticks a second at 64 fps is an eighth of a tick per frame: the
        // first seven frames run nothing and the eighth runs exactly one.
        const perFrame = run(8, 8, DT);
        expect(perFrame.slice(0, 7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
        expect(perFrame[7]).toBe(1);
    });

    it("loses no ticks when a fast speed is chopped across frames", () => {
        // 64 frames of 1/64 s at 1000 ticks/s is one second: 1000 ticks, whether
        // they land 15 or 16 to a frame.
        expect(run(64, 1000, DT).reduce((sum, value) => sum + value, 0)).toBe(1000);
    });

    it("does not fast-forward a world left running while nothing rendered", () => {
        // A minute of wall clock in a single frame must not replay the minute.
        const advance = advanceTicks(0, 1000, 60);
        expect(advance.ticks).toBe(MAX_TICKS_PER_FRAME);
        // The backlog is dropped, so the next frame is normal rather than the
        // start of a long catch-up burst.
        expect(advance.carry).toBeLessThanOrEqual(1);
        const next = advanceTicks(advance.carry, 1000, DT);
        expect(next.ticks).toBeLessThanOrEqual(17);
    });

    it("treats negative time or a negative speed as no ticks", () => {
        expect(advanceTicks(0, 1000, -1).ticks).toBe(0);
        expect(advanceTicks(0, -1000, DT).ticks).toBe(0);
    });

    it("shows the speed in the unit being chosen", () => {
        expect(speedLabel(DEFAULT_TICKS_PER_SECOND)).toBe("500/s");
        expect(speedLabel(1)).toBe("1/s");
    });
});
