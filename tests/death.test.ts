import { describe, expect, it } from "vitest";
import {
    CARRION_FRESH_SCALE,
    CARRION_GONE_SCALE,
    COLLAPSE_HEIGHT,
    COLLAPSE_WIDTH,
    carrionPose,
    collapsePose,
} from "../src/render/meshes";

describe("death collapse", () => {
    it("starts at the animal's living size", () => {
        const p = collapsePose(2, 0);
        expect(p.width).toBeCloseTo(2, 10);
        expect(p.height).toBeCloseTo(2, 10);
    });

    it("ends flattened and shrunken, but not vanished", () => {
        const p = collapsePose(1, 1);
        expect(p.height).toBeCloseTo(COLLAPSE_HEIGHT, 10);
        expect(p.width).toBeCloseTo(COLLAPSE_WIDTH, 10);
        // Flattened much harder than it shrinks, so it reads as a body
        // slumping into the ground rather than a shrinking ball.
        expect(p.height).toBeLessThan(p.width);
    });

    it("deflates monotonically as the collapse progresses", () => {
        let prevWidth = Infinity;
        let prevHeight = Infinity;
        for (let i = 0; i <= 10; i++) {
            const p = collapsePose(1, i / 10);
            expect(p.width).toBeLessThanOrEqual(prevWidth);
            expect(p.height).toBeLessThanOrEqual(prevHeight);
            prevWidth = p.width;
            prevHeight = p.height;
        }
    });

    it("drops fast and settles, rather than fading linearly", () => {
        const half = collapsePose(1, 0.5);
        const linearHeight = (1 + COLLAPSE_HEIGHT) / 2;
        expect(half.height).toBeLessThan(linearHeight);
    });

    it("clamps progress outside 0..1", () => {
        expect(collapsePose(1, -5)).toEqual(collapsePose(1, 0));
        expect(collapsePose(1, 9)).toEqual(collapsePose(1, 1));
    });

    it("scales with the dead animal's size", () => {
        const small = collapsePose(0.5, 0.5);
        const large = collapsePose(1.5, 0.5);
        expect(large.width).toBeCloseTo(small.width * 3, 10);
        expect(large.height).toBeCloseTo(small.height * 3, 10);
    });
});

describe("carrion deflation", () => {
    it("starts at full mass and shrinks away as it decays", () => {
        expect(carrionPose(1).width).toBeCloseTo(CARRION_FRESH_SCALE, 10);
        expect(carrionPose(0).width).toBeCloseTo(CARRION_GONE_SCALE, 10);
        // Nearly gone by the time the corpse is spent, so it disappears from
        // sight rather than holding its size and blinking out.
        expect(carrionPose(0).width).toBeLessThan(carrionPose(1).width * 0.2);
    });

    it("deflates monotonically as mass is lost", () => {
        // Walk from a fresh corpse (mass 1) down to a spent one (mass 0).
        let prev = Infinity;
        for (let i = 10; i >= 0; i--) {
            const width = carrionPose(i / 10).width;
            expect(width).toBeLessThanOrEqual(prev);
            prev = width;
        }
    });

    it("flattens as it settles, never taller than it is wide", () => {
        for (const r of [0, 0.25, 0.5, 0.75, 1]) {
            const pose = carrionPose(r);
            // A fresh corpse is a round ball (height == width); it only ever
            // gets flatter from there.
            expect(pose.height).toBeLessThanOrEqual(pose.width);
        }
        // A fresh corpse is at its roundest; a spent one is a flat smear.
        expect(carrionPose(1).height / carrionPose(1).width).toBeGreaterThan(
            carrionPose(0).height / carrionPose(0).width,
        );
    });

    it("clamps remaining mass outside 0..1", () => {
        // Energy can exceed the first-observed value if a corpse is drawn
        // before it starts decaying, so the top end must clamp.
        expect(carrionPose(3)).toEqual(carrionPose(1));
        expect(carrionPose(-1)).toEqual(carrionPose(0));
    });
});
