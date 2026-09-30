import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import { sacredSeedToBrain } from "../src/sim/persistence";
import type { GodMemory } from "../src/sim/types";

describe("God Agent & Social Learning End-to-End Simulation", () => {
    it("runs multi-epoch simulation demonstrating learning, social alarms, and seed archiving", () => {
        // Epoch 1: Initialize world with GodAgent, juvenile imitation, and pack social mode
        const config1 = {
            ...makeSeeding(20260907),
            herbivoreCount: 20,
            carnivoreCount: 6,
            plantCount: 60,
            enableGodAgent: true,
            socialMode: "pack" as const,
            socialCohesion: 0.8,
            juvenileDuration: 150,
        };

        const world1 = new World(config1);
        expect(world1.godAgent).toBeDefined();

        // Run simulation for 300 ticks
        for (let t = 0; t < 300; t++) {
            if (world1.gameOver !== null) break;
            world1.tickStep();
        }

        expect(world1.tick).toBe(300);

        // Harvest champions into GodMemory
        world1.godAgent!.harvestSacredSeeds();
        const exportedMem: GodMemory = world1.godAgent!.exportMemory();

        expect(exportedMem.sacredSeeds.herbivore).toBeDefined();
        expect(exportedMem.sacredSeeds.carnivore).toBeDefined();
        expect(exportedMem.eons).toBeGreaterThanOrEqual(1);

        // Epoch 2: Re-seed a new world using the exported Sacred Seeds from Epoch 1!
        const nextFounderGenomes = {
            herbivore: sacredSeedToBrain(exportedMem.sacredSeeds.herbivore),
            carnivore: sacredSeedToBrain(exportedMem.sacredSeeds.carnivore),
        };

        const config2 = {
            ...makeSeeding(20260908),
            founderGenomes: nextFounderGenomes,
            godMemory: exportedMem,
            enableGodAgent: true,
            socialMode: "pack" as const,
            socialCohesion: 0.8,
            juvenileDuration: 150,
        };

        const world2 = new World(config2);
        expect(world2.entities.length).toBeGreaterThan(0);

        // Run Epoch 2
        for (let t = 0; t < 200; t++) {
            if (world2.gameOver !== null) break;
            world2.tickStep();
        }

        expect(world2.tick).toBe(200);
        expect(world2.populationOf("herbivore") + world2.populationOf("carnivore")).toBeGreaterThan(0);
    });
});
