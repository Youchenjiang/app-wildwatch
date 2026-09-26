import { describe, expect, it } from "vitest";
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

        // Place a plant on top of the single herbivore so it eats on the first tick.
        const herb = world.entities[0];
        const plant = world.plants[0];
        plant.x = herb.pos.x;
        plant.y = herb.pos.y;

        world.tickStep();

        expect(herb.foodEaten).toBeGreaterThan(0);
        expect(herb.memory.size()).toBeGreaterThan(0);

        const sense = world["sense"](herb);
        const inputs = world["buildInputs"](herb, sense);
        const recalled = herb.memory.recall(inputs, 1);
        expect(recalled.length).toBeGreaterThan(0);
        expect(recalled[0].episode.reward).toBeGreaterThan(0);
    });
});
