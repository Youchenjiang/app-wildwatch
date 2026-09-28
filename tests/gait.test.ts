import { describe, expect, it } from "vitest";
import {
    GAIT_HOP,
    GAIT_REFERENCE_TRAVEL,
    GAIT_SQUASH,
    gaitDeform,
    gaitPose,
    nextGait,
} from "../src/render/meshes";

describe("animal gait", () => {
    it("deforms nothing when the animal is not striding", () => {
        for (const wave of [-1, -0.5, 0, 0.5, 1]) {
            const deform = gaitDeform(0, wave);
            expect([deform.x, deform.y, deform.z]).toEqual([1, 1, 1]);
        }
        // Nor at the top and bottom of the wave, where the deform crosses zero.
        expect(gaitDeform(1, 0)).toEqual({ x: 1, y: 1, z: 1 });
    });

    it("is the shape the body's pose is built from", () => {
        for (const base of [0.5, 1, 2]) {
            for (const wave of [-1, -0.3, 0, 0.4, 1]) {
                const deform = gaitDeform(1, wave);
                const pose = gaitPose(base, 1, wave);
                expect(pose.sx).toBeCloseTo(base * deform.x, 12);
                expect(pose.sy).toBeCloseTo(base * deform.y, 12);
                expect(pose.sz).toBeCloseTo(base * deform.z, 12);
            }
        }
    });

    it("keeps the stride's deform to the body: the rig's inverse restores the size", () => {
        // What the pool draws: the body takes `gaitPose`, the rigid feature rig
        // takes whatever cancels it. Every axis has to land back on the
        // animal's own size, or the snout and the ears would come out distorted.
        const base = 1.4;
        for (const gait of [0, 0.4, 1]) {
            for (const wave of [-1, -0.4, 0, 0.6, 1]) {
                const deform = gaitDeform(gait, wave);
                const body = gaitPose(base, gait, wave);
                const rig = { x: 1 / deform.x, y: 1 / deform.y, z: 1 / deform.z };
                expect(body.sx * rig.x, "across").toBeCloseTo(base, 12);
                expect(body.sy * rig.y, "up").toBeCloseTo(base, 12);
                expect(body.sz * rig.z, "along").toBeCloseTo(base, 12);
            }
        }
    });

    it("holds a clean, uniform pose when standing still", () => {
        const pose = gaitPose(1, 0, 1);
        expect(pose.sy).toBeCloseTo(1, 10);
        expect(pose.sx).toBeCloseTo(1, 10);
        expect(pose.sz).toBeCloseTo(1, 10);
        expect(pose.lift).toBe(0);
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
            const pose = gaitPose(1, 1, wave);
            expect(pose.sx * pose.sy * pose.sz).toBeCloseTo(1, 12);
        }
    });

    it("keeps the effect subtle relative to the body size", () => {
        const base = 2;
        for (const wave of [-1, 1]) {
            const pose = gaitPose(base, 1, wave);
            expect(Math.abs(pose.sy / base - 1)).toBeLessThanOrEqual(GAIT_SQUASH + 1e-9);
            expect(pose.lift).toBeGreaterThanOrEqual(0);
            expect(pose.lift).toBeLessThanOrEqual(base * GAIT_HOP + 1e-9);
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
