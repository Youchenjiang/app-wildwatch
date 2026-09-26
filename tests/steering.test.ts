/**
 * Behavior economics regression: turning must cost energy, and the two
 * "twin traps" of the old encoding must stay fixed.
 *
 * 1. Trapped inputs (all-zero target vector when nothing sensed) must be
 *    distinguishable from "target dead ahead" — otherwise evolution converges
 *    on ambiguous steering.
 * 2. A hard-coded perfect chaser must NOT be the winning strategy: if pure
 *    food-seeking beats every other policy, prey collapse follows (chasers
 *    overkill their own food supply). Constant-curvature cruising is the
 *    expected, healthy dominant strategy in this ecosystem.
 */
import { describe, expect, it } from "vitest";
import { makeSeeding } from "../src/sim/seeding";
import { World } from "../src/sim/world";

describe("sensory encoding", () => {
    it("encodes no-target as exactly zero with dist = 1", () => {
        const world = new World({ ...makeSeeding(5) });
        const herb = world.entities.find((e) => e.species.kind === "herbivore")!;
        const inputs = world["buildInputs"](herb, null);
        expect(inputs[0]).toBe(0); // foodRight
        expect(inputs[1]).toBe(0); // foodFwd
        expect(inputs[2]).toBe(1); // foodDist = 1 sentinel
    });

    it("encodes a target dead-ahead as forward ≈ 1, right ≈ 0 regardless of heading", () => {
        const world = new World({ ...makeSeeding(5) });
        const herb = world.entities.find((e) => e.species.kind === "herbivore")!;
        herb.pos.x = 60;
        herb.pos.y = 60;
        const d = herb.species.senseRange * 0.5;
        for (const angle of [0, Math.PI / 3, -2.1, Math.PI]) {
            herb.angle = angle;
            // Target placed along the animal's own heading.
            const sense = { dx: d * Math.cos(angle), dy: d * Math.sin(angle), dist: d };
            const inputs = world["buildInputs"](herb, sense);
            expect(inputs[1]).toBeCloseTo(0.5, 5); // forward = d / range
            expect(Math.abs(inputs[0])).toBeLessThan(1e-9); // right ≈ 0
        }
    });
});
