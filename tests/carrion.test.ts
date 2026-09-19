import { describe, expect, it } from "vitest";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

describe("carrion cycle", () => {
    it("spawns carrion holding the dead entity's energy", () => {
        const world = new World(makeSeeding(9));
        const victim = world.entities[0];
        const energy = victim.energy;
        // Reach into a private method via a cast-free public path: use tickStep
        // starvation is hard to force, so use the preyed path through a carnivore.
        victim.energy = 50;
        (world as unknown as { kill(e: unknown, r: string): void }).kill(victim, "test");
        expect(world.populationOf(victim.species.kind)).toBeLessThan(
            world.config.herbivoreCount,
        );
        expect(world.carrions).toHaveLength(1);
        expect(world.carrions[0]!.energy).toBeCloseTo(50, 5);
        expect(energy).toBeGreaterThan(0);
    });

    it("decays carrion over time until it vanishes", () => {
        const config: WorldConfig = {
            ...makeSeeding(3),
            width: 30,
            height: 30,
            herbivoreCount: 1,
            carnivoreCount: 0,
            plantCount: 1,
            plantRegrowPerTick: 0,
            turnLength: 1,
            carrionDecayPerTick: 0.5,
        };
        const world = new World(config);
        const victim = world.entities[0]!;
        victim.energy = 10;
        (world as unknown as { kill(e: unknown, r: string): void }).kill(victim, "test");
        expect(world.carrions).toHaveLength(1);
        for (let i = 0; i < 30; i++) world.tickStep();
        expect(world.carrions).toHaveLength(0);
    });

    it("lets carnivores scavenge carrion for its energy", () => {
        const config: WorldConfig = {
            ...makeSeeding(5),
            width: 30,
            height: 30,
            herbivoreCount: 0,
            carnivoreCount: 1,
            plantCount: 0,
            plantRegrowPerTick: 0,
            turnLength: 1,
        };
        const world = new World(config);
        // Plant a corpse right on the carnivore.
        const carn = world.entities[0]!;
        const before = carn.energy;
        world.carrions.push({ id: 9999, x: carn.pos.x, y: carn.pos.y, energy: 40, alive: true });
        world.tickStep();
        expect(carn.energy).toBeGreaterThan(before);
        expect(world.carrions).toHaveLength(0);
    });
});
