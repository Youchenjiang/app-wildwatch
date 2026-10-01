import { describe, expect, it } from "vitest";
import { Brain } from "../src/sim/brain";
import { World, DEFAULT_BRAIN_SPEC } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

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

        // Position mother near a plant
        const plant = world.plants[0];
        mother.pos.x = plant.x;
        mother.pos.y = plant.y;
        mother.energy = 50;

        // Position cub close to mother (within 5 units)
        cub.pos.x = plant.x + 2;
        cub.pos.y = plant.y + 2;
        cub.motherId = mother.id;
        cub.juvenileDuration = 300;
        cub.age = 10;
        cub.energy = 50;

        const cubWeightBefore = new Float32Array(cub.brain.w1);

        // Run a tick where mother grazes
        world.tickStep();

        // Check if cub weights updated due to witnessing mother
        let weightChanged = false;
        for (let i = 0; i < cub.brain.w1.length; i++) {
            if (cub.brain.w1[i] !== cubWeightBefore[i]) {
                weightChanged = true;
                break;
            }
        }
        expect(weightChanged).toBe(true);
    });

    it("does not trigger imitation when juvenile is outside observation radius", () => {
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

        // Position cub far away (> 20 units)
        cub.pos.x = plant.x + 50;
        cub.pos.y = plant.y + 50;
        cub.motherId = mother.id;
        cub.juvenileDuration = 300;
        cub.age = 10;
        cub.energy = 50;

        const cubWeightBefore = new Float32Array(cub.brain.w1);

        world.tickStep();

        // Cub was too far away to observe, weights must remain unchanged
        let weightChanged = false;
        for (let i = 0; i < cub.brain.w1.length; i++) {
            if (cub.brain.w1[i] !== cubWeightBefore[i]) {
                weightChanged = true;
                break;
            }
        }
        expect(weightChanged).toBe(false);
    });
});
