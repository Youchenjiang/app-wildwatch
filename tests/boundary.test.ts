import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

describe("boundary bounce", () => {
    it("keeps every entity inside world bounds", () => {
        const world = new World(makeSeeding(11));
        for (let i = 0; i < 800; i++) world.tickStep();
        for (const e of world.entities) {
            expect(e.pos.x).toBeGreaterThanOrEqual(0.5);
            expect(e.pos.x).toBeLessThanOrEqual(world.config.width - 0.5);
            expect(e.pos.y).toBeGreaterThanOrEqual(0.5);
            expect(e.pos.y).toBeLessThanOrEqual(world.config.height - 0.5);
        }
    });

    it("does not trap animals at edges (no wall-pinning)", () => {
        const world = new World(makeSeeding(23));
        const band = 4;
        const W = world.config.width;
        const H = world.config.height;
        let outward = 0;
        let edgeSamples = 0;
        let entitySamples = 0;
        for (let i = 1; i <= 6000; i++) {
            world.tickStep();
            if (i % 100 === 0) {
                for (const e of world.entities) {
                    entitySamples++;
                    if (
                        e.pos.x < band || e.pos.x > W - band ||
                        e.pos.y < band || e.pos.y > H - band
                    ) {
                        edgeSamples++;
                        const vx = Math.cos(e.angle);
                        const vy = Math.sin(e.angle);
                        const dxWall = e.pos.x < W / 2 ? -1 : 1;
                        const dyWall = e.pos.y < H / 2 ? -1 : 1;
                        const distX = Math.min(e.pos.x, W - e.pos.x);
                        const distY = Math.min(e.pos.y, H - e.pos.y);
                        if ((distX < distY ? vx * dxWall : vy * dyWall) > 0.3) outward++;
                    }
                }
            }
        }
        // Pinning = systematically heading into the nearest wall while stuck.
        // Random headings give ~0.40 at this threshold; the old clamp produced
        // 0.68. Bouncing restored randomness (~0.37), so fail above random.
        expect(outward / Math.max(1, edgeSamples)).toBeLessThan(0.5);
        // Regression guard on total edge lingering (old clamp: 0.40).
        expect(edgeSamples / entitySamples).toBeLessThan(0.35);
    });
});
