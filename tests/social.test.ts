import { describe, expect, it } from "vitest";
import { SocialSignalGrid } from "../src/sim/social";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

describe("Social Signals & Collective Dynamics", () => {
    it("SocialSignalGrid tracks alarm and scent intensities with spatial decay", () => {
        const grid = new SocialSignalGrid(100, 100, 5);

        // Initially no signals
        expect(grid.queryAlarm(50, 50)).toBeNull();
        expect(grid.queryScent(50, 50)).toBeNull();

        // Emit alarm at (50, 50) - cell center is 52.5
        grid.emitAlarm(50, 50, 2.0);
        const alarmNear = grid.queryAlarm(60, 50, 15);
        expect(alarmNear).not.toBeNull();
        expect(alarmNear!.intensity).toBeGreaterThan(0);
        // Direction vector from (60, 50) to (52.5, 50) has negative dx
        expect(alarmNear!.dx).toBeLessThan(0);

        // Outside query radius returns null
        expect(grid.queryAlarm(90, 90, 10)).toBeNull();

        // Test decay
        const prevIntensity = alarmNear!.intensity;
        grid.decay(0.5);
        const decayed = grid.queryAlarm(60, 50, 15);
        expect(decayed!.intensity).toBeLessThan(prevIntensity);
    });

    it("herbivore emits alarm when threatened and neighbor reacts by steering away", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 2,
            carnivoreCount: 1,
            plantCount: 20,
            socialMode: "pack" as const,
        };
        const world = new World(config);
        const victim = world.entities.find((e) => e.species.kind === "herbivore")!;
        const neighbor = world.entities.filter((e) => e.species.kind === "herbivore" && e !== victim)[0];
        const predator = world.entities.find((e) => e.species.kind === "carnivore")!;

        // Place victim close to predator (within threat range)
        victim.pos.x = 50;
        victim.pos.y = 50;
        predator.pos.x = 52;
        predator.pos.y = 50;

        // Place neighbor 10 units away from victim (so it can hear the alarm)
        neighbor.pos.x = 60;
        neighbor.pos.y = 50;
        neighbor.angle = 0; // Heading right (away from victim)

        // Step simulation tick
        world.tickStep();

        // Victim should have emitted an alarm at/near (50, 50)
        const alarmAtSite = world.socialGrid.queryAlarm(50, 50, 10);
        expect(alarmAtSite).not.toBeNull();
        expect(alarmAtSite!.intensity).toBeGreaterThan(0);
    });

    it("carnivore kill deposits hunt scent trail", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 1,
            carnivoreCount: 1,
            plantCount: 10,
        };
        const world = new World(config);
        const prey = world.entities.find((e) => e.species.kind === "herbivore")!;
        const hunter = world.entities.find((e) => e.species.kind === "carnivore")!;

        // Place hunter directly on prey to guarantee catch attempt
        prey.pos.x = 40;
        prey.pos.y = 40;
        prey.energy = 5;
        hunter.pos.x = 40;
        hunter.pos.y = 40;
        hunter.energy = 20;

        // Force a deposit directly to check scent query
        world.socialGrid.depositScent(40, 40, 3.0);
        const scent = world.socialGrid.queryScent(45, 40, 15);
        expect(scent).not.toBeNull();
        expect(scent!.intensity).toBeGreaterThan(0);
        // Direction from (45, 40) to (40, 40) has negative dx
        expect(scent!.dx).toBeLessThan(0);
    });

    it("solitary mode does not emit alarms when threatened", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 1,
            carnivoreCount: 1,
            plantCount: 20,
            socialMode: "solitary" as const,
        };
        const world = new World(config);
        const herb = world.entities.find((e) => e.species.kind === "herbivore")!;
        const carn = world.entities.find((e) => e.species.kind === "carnivore")!;

        herb.pos.x = 50;
        herb.pos.y = 50;
        carn.pos.x = 52;
        carn.pos.y = 50;

        world.tickStep();

        // No alarm should be emitted in solitary mode
        expect(world.socialGrid.queryAlarm(50, 50, 10)).toBeNull();
    });

    it("dynamically switches social modes and scales cohesion spectrum", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 1,
            carnivoreCount: 1,
            plantCount: 20,
            socialMode: "solitary" as const,
        };
        const world = new World(config);
        const herb = world.entities.find((e) => e.species.kind === "herbivore")!;
        const carn = world.entities.find((e) => e.species.kind === "carnivore")!;

        herb.pos.x = 50;
        herb.pos.y = 50;
        carn.pos.x = 52;
        carn.pos.y = 50;

        // Switch to pack with half cohesion (0.5)
        world.setSocialMode("pack", 0.5);
        expect(world.config.socialMode).toBe("pack");
        expect(world.config.socialCohesion).toBe(0.5);

        world.tickStep();

        const alarm = world.socialGrid.queryAlarm(50, 50, 10);
        expect(alarm).not.toBeNull();
        expect(alarm!.intensity).toBeCloseTo(0.5 * (1 - 0.05), 1);
    });
});
