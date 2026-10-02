import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

describe("God Agent & Ecosystem Oversight", () => {
    it("triggers bountifulRain when herbivores fall below emergency threshold", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 15, // Below rainPreyThreshold (20)
            carnivoreCount: 5,
            plantCount: 10,
            enableGodAgent: true,
        };
        const world = new World(config);
        const plantCountBefore = world.plants.length;

        // Force god agent evaluation by advancing to eval interval
        if (!world.godAgent) throw new Error("GodAgent not initialized");
        world.godAgent.evalInterval = 1;
        world.tickStep();

        expect(world.plants.length).toBeGreaterThan(plantCountBefore);
        expect(world.godAgent.history.length).toBeGreaterThan(0);
        expect(world.godAgent.history[0].action).toBe("bountifulRain");
    });

    it("triggers metabolicBlight when carnivores explode above threshold", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 50,
            carnivoreCount: 80, // Above blightPredatorThreshold (75)
            plantCount: 100,
            enableGodAgent: true,
        };
        const world = new World(config);
        if (!world.godAgent) throw new Error("GodAgent not initialized");
        world.godAgent.evalInterval = 1;

        const carnCountBefore = world.populationOf("carnivore");
        world.tickStep();

        const carnCountAfter = world.populationOf("carnivore");
        expect(carnCountAfter).toBeLessThan(carnCountBefore);
        expect(world.godAgent.history.some((h) => h.action === "metabolicBlight")).toBe(true);
    });

    it("archives champion genomes as sacred seeds and exports valid GodMemory", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 10,
            carnivoreCount: 5,
            enableGodAgent: true,
        };
        const world = new World(config);
        const god = world.godAgent;
        if (!god) throw new Error("GodAgent not initialized");

        // Give one herbivore high fitness
        const starHerb = world.entities.find((e) => e.species.kind === "herbivore");
        if (!starHerb) throw new Error("Herbivore not found");
        starHerb.fitness = 99999;

        god.harvestSacredSeeds();

        expect(god.memory.sacredSeeds.herbivore.fitness).toBe(99999);
        expect(god.memory.sacredSeeds.herbivore.weights.w1.length).toBe(
            starHerb.brain.spec.inputSize * starHerb.brain.spec.hiddenSize,
        );

        const exported = god.exportMemory();
        expect(exported.sacredSeeds.herbivore.fitness).toBe(99999);
        expect(exported.policy).toBeDefined();
    });
});
