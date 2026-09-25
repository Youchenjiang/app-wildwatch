import { describe, expect, it } from "vitest";
import { createMealLog, type Meal } from "../src/sim/meals";
import { World, type WorldConfig } from "../src/sim/world";

/** A cramped world so a placed plant or corpse is always within reach. */
function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
    return {
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
        populationCap: 500,
        mateRange: 3,
        mutationRate: 0,
        mutationSigma: 0,
        brainSpec: { inputSize: 11, hiddenSize: 2, outputSize: 2 },
        memoryCapacity: 4,
        mealLogCapacity: 3,
        lifeGridCellsize: 6,
        lifeGridDecay: 0,
        lifeGridCap: 20,
        ...overrides,
    };
}

describe("meal log", () => {
    it("starts empty", () => {
        const log = createMealLog(4);
        expect(log.size()).toBe(0);
        expect(log.recent(4)).toEqual([]);
        expect(log.counts()).toEqual({ plant: 0, prey: 0, carrion: 0 });
    });

    it("returns recent meals newest first", () => {
        const log = createMealLog(8);
        log.add({ source: "plant", energy: 5, age: 10 });
        log.add({ source: "prey", energy: 30, age: 40 });
        log.add({ source: "carrion", energy: 12, age: 55 });

        expect(log.recent(2).map((m) => m.source)).toEqual(["carrion", "prey"]);
        expect(log.recent(2)[0].age).toBe(55);
    });

    it("caps remembered meals but keeps counting for life", () => {
        const log = createMealLog(3);
        for (let i = 0; i < 10; i++) log.add({ source: "plant", energy: 1, age: i });

        expect(log.size()).toBe(3);
        expect(log.recent(3).map((m) => m.age)).toEqual([9, 8, 7]);
        // Totals survive eviction: the summary is a lifetime figure.
        expect(log.counts().plant).toBe(10);
    });

    it("counts each food source separately", () => {
        const log = createMealLog(8);
        log.add({ source: "plant", energy: 5, age: 1 });
        log.add({ source: "plant", energy: 5, age: 2 });
        log.add({ source: "prey", energy: 40, age: 3 });
        log.add({ source: "carrion", energy: 9, age: 4 });

        expect(log.counts()).toEqual({ plant: 2, prey: 1, carrion: 1 });
    });

    it("hands out a copy of the counts so callers cannot mutate the log", () => {
        const log = createMealLog(8);
        log.add({ source: "prey", energy: 40, age: 3 });
        const counts = log.counts() as { prey: number };
        counts.prey = 999;
        expect(log.counts().prey).toBe(1);
    });
});

describe("meal recording", () => {
    it("records a herbivore eating a plant", () => {
        const world = new World(makeConfig());
        const herb = world.entities[0];
        const plant = world.plants[0];
        plant.x = herb.pos.x;
        plant.y = herb.pos.y;

        world.tickStep();

        const eaten = herb.meals.recent(1)[0];
        expect(eaten.source).toBe("plant");
        expect(eaten.energy).toBe(20);
        expect(herb.meals.counts().plant).toBe(1);
    });

    it("records a carnivore scavenging carrion, with the corpse it ate", () => {
        const world = new World(makeConfig({ herbivoreCount: 0, carnivoreCount: 1, plantCount: 0 }));
        const carn = world.entities[0];
        const corpse = { id: 4242, x: carn.pos.x, y: carn.pos.y, energy: 33, alive: true, fromId: 777 };
        world.carrions.push(corpse);

        world.tickStep();

        const eaten = carn.meals.recent(1)[0];
        expect(eaten.source).toBe("carrion");
        expect(eaten.energy).toBe(33);
        // The meal names the animal the body was, not the transient corpse id.
        expect(eaten.victimId).toBe(777);
        expect(eaten.kin).toBeUndefined();
        expect(carn.meals.counts()).toEqual({ plant: 0, prey: 0, carrion: 1 });
    });

    it("records a kill as prey, carrying the victim's generation", () => {
        // Dense prey so the catch roll saturates; the carnivore is parked on top
        // of a herbivore every tick until a kill lands.
        const world = new World(
            makeConfig({ herbivoreCount: 40, carnivoreCount: 1, plantCount: 100, populationCap: 500 }),
        );
        const carn = world.entities.find((e) => e.species.kind === "carnivore")!;
        const herb = world.entities.find((e) => e.species.kind === "herbivore")!;
        // Any of the herd may be the one caught, so give them all the same
        // generation and the assertion holds whichever victim it turns out to be.
        for (const e of world.entities) if (e.species.kind === "herbivore") e.generation = 6;

        let victim: Meal | undefined;
        for (let i = 0; i < 500 && !victim; i++) {
            herb.pos.x = carn.pos.x;
            herb.pos.y = carn.pos.y;
            world.tickStep();
            victim = carn.meals.recent(1).find((m) => m.source === "prey");
        }

        expect(victim).toBeTruthy();
        expect(victim!.victimGeneration).toBe(6);
        expect(carn.meals.counts().prey).toBeGreaterThan(0);
    });

    it("gives every entity its own log", () => {
        const world = new World(makeConfig({ herbivoreCount: 2, plantCount: 2 }));
        const [a, b] = world.entities;
        a.meals.add({ source: "plant", energy: 1, age: 1 });
        expect(b.meals.size()).toBe(0);
    });
});
