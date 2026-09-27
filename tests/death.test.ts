import { describe, expect, it } from "vitest";
import {
    CARRION_DECAY_BUDGET,
    CARRION_FRESH_SCALE,
    CARRION_GONE_SCALE,
    COLLAPSE_HEIGHT,
    COLLAPSE_WIDTH,
    carrionExit,
    carrionPose,
    collapsePose,
    feedPose,
} from "../src/render/meshes";

describe("death collapse", () => {
    it("starts at the animal's living size", () => {
        const pose = collapsePose(2, 0);
        expect(pose.width).toBeCloseTo(2, 10);
        expect(pose.height).toBeCloseTo(2, 10);
    });

    it("ends flattened and shrunken, but not vanished", () => {
        const pose = collapsePose(1, 1);
        expect(pose.height).toBeCloseTo(COLLAPSE_HEIGHT, 10);
        expect(pose.width).toBeCloseTo(COLLAPSE_WIDTH, 10);
        // Flattened much harder than it shrinks, so it reads as a body
        // slumping into the ground rather than a shrinking ball.
        expect(pose.height).toBeLessThan(pose.width);
    });

    it("deflates monotonically as the collapse progresses", () => {
        let prevWidth = Infinity;
        let prevHeight = Infinity;
        for (let i = 0; i <= 10; i++) {
            const pose = collapsePose(1, i / 10);
            expect(pose.width).toBeLessThanOrEqual(prevWidth);
            expect(pose.height).toBeLessThanOrEqual(prevHeight);
            prevWidth = pose.width;
            prevHeight = pose.height;
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
        for (const remaining of [0, 0.25, 0.5, 0.75, 1]) {
            const pose = carrionPose(remaining);
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

describe("corpse exits", () => {
    it("reads a corpse removed with mass left as eaten", () => {
        expect(carrionExit(60)).toBe("eaten");
        expect(carrionExit(CARRION_DECAY_BUDGET + 0.01)).toBe("eaten");
    });

    it("reads a corpse removed at its last sliver as decayed", () => {
        // Decay is the only other way out, and it removes the corpse only once
        // its energy is spent.
        expect(carrionExit(0)).toBe("decayed");
        expect(carrionExit(CARRION_DECAY_BUDGET)).toBe("decayed");
    });

    it("covers a whole frame's worth of decay at the fastest speed", () => {
        // 0.05 energy/tick at up to 60 ticks per drawn frame is the most a
        // corpse can lose between frames without being eaten.
        expect(CARRION_DECAY_BUDGET).toBeGreaterThan(0.05 * 60);
    });
});

describe("scavenging", () => {
    it("starts at the corpse's size, at rest", () => {
        const pose = feedPose(0.8, 0.6, 0);
        expect(pose.width).toBeCloseTo(0.8, 10);
        expect(pose.height).toBeCloseTo(0.6, 10);
        expect(pose.eased).toBe(0);
    });

    it("shrinks to a morsel by the time it is swallowed", () => {
        const pose = feedPose(1, 1, 1);
        expect(pose.eased).toBe(1);
        expect(pose.width).toBeLessThan(0.2);
        expect(pose.width).toBeGreaterThan(0);
        expect(pose.height).toBeLessThan(0.2);
    });

    it("shrinks monotonically as it is pulled in", () => {
        let prev = Infinity;
        for (let i = 0; i <= 10; i++) {
            const width = feedPose(1, 1, i / 10).width;
            expect(width).toBeLessThanOrEqual(prev);
            prev = width;
        }
    });

    it("yanks the corpse in early rather than easing it out linearly", () => {
        // The pull toward the eater uses the eased progress, so most of the
        // travel should happen in the first half of the animation.
        expect(feedPose(1, 1, 0.5).eased).toBeGreaterThan(0.5);
    });

    it("preserves the corpse's proportions as it shrinks", () => {
        const pose = feedPose(0.8, 0.4, 0.6);
        expect(pose.width / pose.height).toBeCloseTo(0.8 / 0.4, 10);
    });

    it("clamps progress outside 0..1", () => {
        expect(feedPose(1, 1, -3)).toEqual(feedPose(1, 1, 0));
        expect(feedPose(1, 1, 7)).toEqual(feedPose(1, 1, 1));
    });
});
