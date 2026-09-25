import { describe, expect, it } from "vitest";
import { Brain } from "../src/sim/brain";
import { World, type WorldConfig } from "../src/sim/world";
import { SPECIES } from "../src/sim/species";

describe("episodic memory wiring", () => {
    it("records an episode when an entity eats and recall can find it", () => {
        const config: WorldConfig = {
            width: 30,
            height: 30,
            seed: 7,
            herbivoreCount: 1,
            carnivoreCount: 0,
            plantCount: 1,
            plantRegrowPerTick: 0,
            plantEnergy: 20,
            maxPlants: 1,
            turnLength: 1,
            populationCap: 10,
            mateRange: 3,
            mutationRate: 0,
            mutationSigma: 0,
            brainSpec: { inputSize: 6, hiddenSize: 2, outputSize: 2 },
            memoryCapacity: 4,
            lifeGridCellsize: 6,
            lifeGridDecay: 0,
            lifeGridCap: 20,
        };

        const world = new World(config);

        // Put the single herbivore on top of the plant so it eats on the first
        // tick. The animal is the one that moves: a plant is filed in the index
        // where it grew and is never re-filed, so shifting the plant would
        // leave grazing unable to see it at all.
        const herb = world.entities[0];
        const plant = world.plants[0];
        herb.pos.x = plant.x;
        herb.pos.y = plant.y;

        world.tickStep();

        expect(herb.foodEaten).toBeGreaterThan(0);
        expect(herb.memory.size()).toBeGreaterThan(0);

        const sense = world["sense"](herb);
        const inputs = world["buildInputs"](herb, sense);
        const recalled = herb.memory.recall(inputs, 1);
        expect(recalled.length).toBeGreaterThan(0);
        expect(recalled[0].episode.reward).toBeGreaterThan(0);
    });

    it("records the steer the entity was applying when it ate", () => {
        const config: WorldConfig = {
            width: 30,
            height: 30,
            seed: 7,
            herbivoreCount: 1,
            carnivoreCount: 0,
            plantCount: 1,
            plantRegrowPerTick: 0,
            plantEnergy: 20,
            maxPlants: 1,
            turnLength: 1,
            populationCap: 10,
            mateRange: 3,
            mutationRate: 0,
            mutationSigma: 0,
            brainSpec: { inputSize: 11, hiddenSize: 2, outputSize: 2 },
            memoryCapacity: 4,
            lifeGridCellsize: 6,
            lifeGridDecay: 0,
            lifeGridCap: 20,
        };

        const world = new World(config);
        const herb = world.entities[0];

        // Constant right-turner: steer = tanh(1) ≈ 0.762, thrust = 0.
        const spec = { inputSize: 11, hiddenSize: 2, outputSize: 2 };
        const w1 = new Float32Array(2 * 11);
        const b1 = new Float32Array(2);
        const w2 = new Float32Array(2 * 2);
        const b2 = new Float32Array(2);
        b2[0] = 1; // out0 = tanh(1)
        herb.brain = new Brain(spec, w1, b1, w2, b2);

        // Plant just ahead of the heading; the turner sweeps into range in one
        // tick. Placing the animal rather than the plant keeps the geometry
        // identical (the plant is one unit ahead in +x).
        const plant = world.plants[0];
        herb.angle = 0; // heading +x
        herb.pos.x = plant.x - 1;
        herb.pos.y = plant.y;

        const sense = world["sense"](herb);
        const inputs = world["buildInputs"](herb, sense);
        // The observer lens (inspector memory panel) sees the same inputs.
        expect(world.inputsFor(herb)).toEqual(inputs);

        world.tickStep();

        expect(herb.foodEaten).toBe(1);
        const recalled = herb.memory.recall(inputs, 1);
        expect(recalled.length).toBeGreaterThan(0);
        // The episode must carry the actual steer (≈0.762), not a hard-coded 0.
        expect(recalled[0].episode.actionHint).toBeCloseTo(Math.tanh(1), 5);
    });
});
