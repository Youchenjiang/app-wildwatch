import { describe, expect, it } from "vitest";
import { GAIT_HOP, GAIT_REFERENCE_TRAVEL, GAIT_SQUASH, gaitPose, nextGait } from "../src/render/meshes";

describe("animal gait", () => {
    it("holds a clean, uniform pose when standing still", () => {
        const p = gaitPose(1, 0, 1);
        expect(p.sy).toBeCloseTo(1, 10);
        expect(p.sx).toBeCloseTo(1, 10);
        expect(p.sz).toBeCloseTo(1, 10);
        expect(p.lift).toBe(0);
    });

    it("stretches tall when airborne, squashes wide on the landing", () => {
        const base = 1;
        const up = gaitPose(base, 1, 1);
        expect(up.sy).toBeGreaterThan(base); // stretched tall
        expect(up.sx).toBeLessThan(base); // and thinner
        expect(up.lift).toBeGreaterThan(0); // airborne

        const down = gaitPose(base, 1, -1);
        expect(down.sy).toBeLessThan(base); // squashed short
        expect(down.sx).toBeGreaterThan(base); // and wider
        expect(down.lift).toBe(0); // a footfall never sinks below rest height
    });

    it("deforms rather than resizes: volume is preserved exactly", () => {
        for (const wave of [-1, -0.5, 0, 0.5, 1]) {
            const p = gaitPose(1, 1, wave);
            expect(p.sx * p.sy * p.sz).toBeCloseTo(1, 12);
        }
    });

    it("keeps the effect subtle relative to the body size", () => {
        const base = 2;
        for (const wave of [-1, 1]) {
            const p = gaitPose(base, 1, wave);
            expect(Math.abs(p.sy / base - 1)).toBeLessThanOrEqual(GAIT_SQUASH + 1e-9);
            expect(p.lift).toBeGreaterThanOrEqual(0);
            expect(p.lift).toBeLessThanOrEqual(base * GAIT_HOP + 1e-9);
        }
    });

    it("scales the whole pose with the animal's size", () => {
        const small = gaitPose(0.5, 1, 0.5);
        const large = gaitPose(1.5, 1, 0.5);
        expect(large.sy).toBeCloseTo(small.sy * 3, 10);
        expect(large.lift).toBeCloseTo(small.lift * 3, 10);
    });

    it("rises to a travel target at once and eases back down when it stops", () => {
        expect(nextGait(0, 0)).toBe(0);
        // Any real movement saturates the signal to a full stride.
        expect(nextGait(0, GAIT_REFERENCE_TRAVEL)).toBe(1);
        expect(nextGait(0, GAIT_REFERENCE_TRAVEL * 10)).toBe(1);
        // Half a stride of travel reads as half a stride.
        expect(nextGait(0, GAIT_REFERENCE_TRAVEL / 2)).toBeCloseTo(0.5, 10);
        // Stopping eases off smoothly instead of snapping to a still pose.
        expect(nextGait(1, 0)).toBeGreaterThan(0.5);
        expect(nextGait(1, 0)).toBeLessThan(1);
        let gait = 1;
        for (let i = 0; i < 30; i++) gait = nextGait(gait, 0);
        expect(gait).toBeLessThan(0.05);
    });
});
