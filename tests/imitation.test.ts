import { describe, expect, it } from "vitest";
import { Brain } from "../src/sim/brain";
import type { Entity } from "../src/sim/entity";
import { World, DEFAULT_BRAIN_SPEC } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

/** Checks whether any element in a Float32Array changed compared to a snapshot. */
function weightsChanged(current: Float32Array, snapshot: Float32Array): boolean {
    for (let i = 0; i < current.length; i++) {
        if (current[i] !== snapshot[i]) return true;
    }
    return false;
}

/** Builds a minimal two-herbivore world with a plant nearby and a juvenile cub. */
function makeImitationWorld(cubOffsetX: number, cubOffsetY: number): {
    world: World;
    cub: Entity;
    cubWeightSnapshot: Float32Array;
} {
    const config = {
        ...makeSeeding(20260907),
        herbivoreCount: 2,
        carnivoreCount: 0,
        plantCount: 50,
        juvenileDuration: 300,
    };
    const world = new World(config);
    const mother = world.entities[0];
    const cub = world.entities[1];

    const plant = world.plants[0];
    mother.pos.x = plant.x;
    mother.pos.y = plant.y;
    mother.energy = 50;

    cub.pos.x = plant.x + cubOffsetX;
    cub.pos.y = plant.y + cubOffsetY;
    cub.motherId = mother.id;
    cub.juvenileDuration = 300;
    cub.age = 10;
    cub.energy = 50;

    const cubWeightSnapshot = new Float32Array(cub.brain.w1);
    return { world, cub, cubWeightSnapshot };
}

describe("Behavior Cloning & Juvenile Imitation Learning", () => {
    it("learnImitation reduces prediction error via backpropagation", () => {
        let seed = 12345;
        const rng = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };
        const brain = Brain.random(DEFAULT_BRAIN_SPEC, rng);
        const inputs = [0.5, -0.2, 0.8, 0.1, 0, 0, 0, 0, 0, 0, 0];
        const targetOutput = [0.8, -0.5];

        const initialOut = brain.forward(inputs);
        const initialLoss =
            Math.hypot(targetOutput[0] - initialOut[0], targetOutput[1] - initialOut[1]);

        // Run several imitation learning steps
        for (let step = 0; step < 10; step++) {
            brain.learnImitation(inputs, targetOutput, 0.1);
        }

        const trainedOut = brain.forward(inputs);
        const trainedLoss =
            Math.hypot(targetOutput[0] - trainedOut[0], targetOutput[1] - trainedOut[1]);

        expect(trainedLoss).toBeLessThan(initialLoss);
    });

    it("triggers imitation in nearby juveniles when mother grazes", () => {
        // Cub is 2 units away — within the 15-unit observation radius
        const { world, cub, cubWeightSnapshot } = makeImitationWorld(2, 2);
        world.tickStep();
        expect(weightsChanged(cub.brain.w1, cubWeightSnapshot)).toBe(true);
    });

    it("does not trigger imitation when juvenile is outside observation radius", () => {
        // Cub is 50 units away — outside the 15-unit observation radius
        const { world, cub, cubWeightSnapshot } = makeImitationWorld(50, 50);
        world.tickStep();
        expect(weightsChanged(cub.brain.w1, cubWeightSnapshot)).toBe(false);
    });
});
