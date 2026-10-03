import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import { GodAgent } from "../src/sim/god";

describe("sandbox mode and runtime interventions", () => {
    it("starts as a pristine run with no interventions", () => {
        const world = new World(makeSeeding(42));
        expect(world.intervened).toBe(false);
        expect(world.interventions).toHaveLength(0);

        world.tickStep();
        const record = world.records.at(-1);
        if (record) {
            expect(record.intervened).toBe(false);
        }
    });

    it("records intervention when reproduction mode is changed dynamically", () => {
        const world = new World({ ...makeSeeding(42), reproduction: "asexual" });
        expect(world.config.reproduction).toBe("asexual");

        world.setReproductionMode("sexual");
        expect(world.config.reproduction).toBe("sexual");
        expect(world.intervened).toBe(true);
        expect(world.interventions).toHaveLength(1);
        expect(world.interventions[0].action).toBe("reproduction:asexual->sexual");

        // Setting same mode is a no-op
        world.setReproductionMode("sexual");
        expect(world.interventions).toHaveLength(1);
    });

    it("records intervention when plant regrow rate is adjusted", () => {
        const world = new World(makeSeeding(42));
        const initialRate = world.config.plantRegrowPerTick;

        world.setPlantRegrowRate(initialRate * 2);
        expect(world.config.plantRegrowPerTick).toBe(initialRate * 2);
        expect(world.intervened).toBe(true);
        expect(world.interventions[0].action).toContain("plantRegrow:");
    });

    it("records plant burst intervention and spawns additional plants", () => {
        const world = new World(makeSeeding(42));
        const initialCount = world.plants.length;

        world.spawnPlantBurst(5);
        expect(world.plants.length).toBe(initialCount + 5);
        expect(world.intervened).toBe(true);
        expect(world.interventions[0].action).toBe("plantBurst:+5");
    });

    it("flags turn records with intervened status once modified", () => {
        const world = new World({ ...makeSeeding(42), turnLength: 10 });
        for (let i = 0; i < 10; i++) world.tickStep();
        expect(world.records[0].intervened).toBe(false);

        world.setReproductionMode("sexual");
        for (let i = 0; i < 10; i++) world.tickStep();
        expect(world.records[1].intervened).toBe(true);
    });

    it("prevents sacred seed harvesting from intervened sandbox runs", () => {
        const world = new World({
            ...makeSeeding(42),
            enableGodAgent: true,
        });
        const god = world.godAgent;
        expect(god).toBeDefined();
        if (!god) return;

        // Set high fitness on an animal
        const herb = world.entities.find((e) => e.species.kind === "herbivore");
        if (herb) herb.fitness = 99999;

        // Flag world as intervened
        world.recordIntervention("manual_test_adjustment");
        god.harvestSacredSeeds();

        // Sacred seed should not be updated with this intervened champion
        const archivedSeed = god.memory.sacredSeeds.herbivore;
        if (archivedSeed) {
            expect(archivedSeed.fitness).not.toBe(99999);
        }
    });
});
