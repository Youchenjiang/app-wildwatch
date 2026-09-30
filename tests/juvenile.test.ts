import { describe, expect, it } from "vitest";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

describe("Juvenile Lifecycle & Mother Imprinting", () => {
    it("founders start with no motherId and are not juvenile", () => {
        const world = new World(makeSeeding(20260907));
        for (const e of world.entities) {
            expect(e.motherId).toBeNull();
            expect(e.isJuvenile).toBe(false);
        }
    });

    it("newborn offspring imprint on mother and start in juvenile stage", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 2,
            carnivoreCount: 0,
            plantCount: 100,
            juvenileDuration: 150,
        };
        const world = new World(config);
        const mother = world.entities[0];

        // Give mother enough energy to reproduce
        mother.energy = mother.species.reproduceEnergy + 10;
        mother.reproduceCooldown = 0;

        const countBefore = world.entities.length;
        // Run until reproduction happens
        for (let t = 0; t < 50; t++) {
            world.tickStep();
            if (world.entities.length > countBefore) break;
        }

        const offspring = world.entities.find((e) => e.motherId === mother.id);
        expect(offspring).toBeDefined();
        if (offspring) {
            expect(offspring.motherId).toBe(mother.id);
            expect(offspring.juvenileDuration).toBe(150);
            expect(offspring.isJuvenile).toBe(true);

            // Fast-forward offspring age beyond juvenile duration
            offspring.age = 151;
            expect(offspring.isJuvenile).toBe(false);
        }
    });

    it("juvenile follows mother when separated", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 2,
            carnivoreCount: 0,
            juvenileDuration: 300,
        };
        const world = new World(config);
        const mother = world.entities[0];
        const cub = world.entities[1];

        // Manually imprint cub on mother
        mother.pos.x = 20;
        mother.pos.y = 20;

        cub.motherId = mother.id;
        cub.juvenileDuration = 300;
        cub.age = 10;
        cub.pos.x = 40; // Separated by 20 units
        cub.pos.y = 20;
        cub.angle = 0; // Facing away from mother initially

        const initialDistance = Math.hypot(cub.pos.x - mother.pos.x, cub.pos.y - mother.pos.y);

        // Run ticks with mother stationary
        for (let t = 0; t < 20; t++) {
            mother.energy = 50; // keep alive
            cub.energy = 50;
            world.tickStep();
        }

        const finalDistance = Math.hypot(cub.pos.x - mother.pos.x, cub.pos.y - mother.pos.y);
        expect(finalDistance).toBeLessThan(initialDistance);
    });
});
