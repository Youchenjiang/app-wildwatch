import { describe, expect, it, vi } from "vitest";
import {
    createDefaultGodMemory,
    loadGodMemory,
    sacredSeedToBrain,
} from "../src/sim/persistence";
import rawGodMemory from "../public/data/god-memory.json";
import type { GodMemory } from "../src/sim/types";

describe("Persistence & God Memory Loader", () => {
    it("converts a SacredSeed into a runnable Brain instance", () => {
        const memory = rawGodMemory as unknown as GodMemory;
        const brain = sacredSeedToBrain(memory.sacredSeeds.herbivore);
        expect(brain).toBeDefined();

        const input = new Array(11).fill(0.2);
        const output = brain.forward(input);
        expect(output.length).toBe(2);
        expect(Number.isFinite(output[0])).toBe(true);
        expect(Number.isFinite(output[1])).toBe(true);
    });

    it("creates a valid default GodMemory fallback", () => {
        const fallback = createDefaultGodMemory();
        expect(fallback.version).toBe("1.0.0-fallback");
        expect(fallback.sacredSeeds.herbivore.weights.w1.length).toBe(55);
        expect(fallback.sacredSeeds.carnivore.weights.w1.length).toBe(55);
    });

    it("loads god memory via fetch when available", async () => {
        const mockData = rawGodMemory as unknown as GodMemory;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockData,
        });
        vi.stubGlobal("fetch", fetchMock);

        const loaded = await loadGodMemory("https://example.com/god-memory.json");
        expect(loaded.version).toBe("1.0.0");
        expect(fetchMock).toHaveBeenCalledWith("https://example.com/god-memory.json");

        vi.unstubAllGlobals();
    });

    it("falls back gracefully when fetch fails", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
        vi.stubGlobal("fetch", fetchMock);

        const loaded = await loadGodMemory("invalid-url");
        expect(loaded.version).toBe("1.0.0-fallback");

        vi.unstubAllGlobals();
    });

    it("seeds World founders with sacred brains from GodMemory", async () => {
        const memory = rawGodMemory as unknown as GodMemory;
        const herbBrain = sacredSeedToBrain(memory.sacredSeeds.herbivore);
        const carnBrain = sacredSeedToBrain(memory.sacredSeeds.carnivore);

        const { World } = await import("../src/sim/world");
        const { makeSeeding } = await import("../src/sim/seeding");

        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 10,
            carnivoreCount: 2,
            founderGenomes: {
                herbivore: herbBrain,
                carnivore: carnBrain,
            },
        };

        const world = new World(config);
        const herbivores = world.entities.filter((e) => e.species.kind === "herbivore");
        const carnivores = world.entities.filter((e) => e.species.kind === "carnivore");

        expect(herbivores.length).toBe(10);
        expect(carnivores.length).toBe(2);

        // Verify founder brain weights correlate with the sacred seed (within light mutation distance)
        const herbSample = herbivores[0].brain;
        let diff = 0;
        for (let i = 0; i < herbBrain.w1.length; i++) {
            diff += Math.abs(herbSample.w1[i] - herbBrain.w1[i]);
        }
        const avgDiff = diff / herbBrain.w1.length;
        expect(avgDiff).toBeLessThan(0.3); // Light mutation variation around archetype
    });
});
