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
import { Brain } from "../src/sim/brain";
import { makeSeeding } from "../src/sim/seeding";
import { SPECIES } from "../src/sim/species";
import { turnEnergyMultiplier, World, type WorldConfig } from "../src/sim/world";

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

describe("turn energy cost", () => {
    it("turnEnergyMultiplier: turning costs energy only when turnCost > 0", () => {
        expect(turnEnergyMultiplier(0, 1, 1)).toBe(1); // no cost configured
        expect(turnEnergyMultiplier(1, 0, 1)).toBe(1); // no steering, no cost
        expect(turnEnergyMultiplier(1, 1, 1)).toBe(2); // full steer + full thrust
        expect(turnEnergyMultiplier(0.8, 1, 0)).toBeCloseTo(1.24, 5);
        expect(turnEnergyMultiplier(1, 0.5, 1)).toBeCloseTo(1.25, 5);
        // Cost grows with steer², so cruising stays cheap and chasing bites.
        expect(turnEnergyMultiplier(1, 1, 1) - 1).toBe(4 * (turnEnergyMultiplier(1, 0.5, 1) - 1));
    });

    it("a hard turner burns more energy than a straight cruiser in-world", () => {
        const config: WorldConfig = {
            width: 30,
            height: 30,
            seed: 7,
            herbivoreCount: 2,
            carnivoreCount: 0,
            plantCount: 0,
            plantRegrowPerTick: 0,
            plantEnergy: 20,
            maxPlants: 0,
            turnLength: 1000,
            populationCap: 10,
            mateRange: 3,
            mutationRate: 0,
            mutationSigma: 0,
            brainSpec: { inputSize: 11, hiddenSize: 2, outputSize: 2 },
        };
        const spec = { inputSize: 11, hiddenSize: 2, outputSize: 2 };
        const makeBrain = (steerBias: number): Brain => {
            const w1 = new Float32Array(2 * 11);
            const b1 = new Float32Array(2);
            const w2 = new Float32Array(2 * 2);
            const b2 = new Float32Array(2);
            b2[0] = steerBias;
            return new Brain(spec, w1, b1, w2, b2);
        };
        const run = (turnCost: number): [number, number] => {
            const world = new World(config);
            const [turner, straight] = world.entities;
            turner.brain = makeBrain(1); // steer = tanh(1) ≈ 0.762
            straight.brain = makeBrain(0); // steer = 0
            for (const e of world.entities) {
                e.pos.x = 15;
                e.pos.y = 15;
                e.angle = 0;
                e.energy = 60; // below reproduceEnergy so they never breed
            }
            const saved = SPECIES.herbivore.turnCost;
            SPECIES.herbivore.turnCost = turnCost;
            try {
                for (let i = 0; i < 10; i++) world.tickStep();
            } finally {
                SPECIES.herbivore.turnCost = saved;
            }
            return [turner.energy, straight.energy];
        };
        // turnCost 0: identical burn regardless of steering.
        const [t0, s0] = run(0);
        expect(t0).toBeCloseTo(s0, 5);
        // turnCost 1: the turner pays extra movement energy.
        const [t1, s1] = run(1);
        expect(t1).toBeLessThan(s1);
        expect(s1 - t1).toBeGreaterThan(0.05);
    });
});
