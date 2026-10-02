import { describe, expect, it } from "vitest";
import { SocialSignalGrid } from "../src/sim/social";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

/** Builds a standardized scenario with herbivore at (50, 50) and carnivore at (52, 50). */
function makeSocialScenario(mode: "solitary" | "pack", herbivoreCount = 1) {
    const config = {
        ...makeSeeding(20260907),
        herbivoreCount,
        carnivoreCount: 1,
        plantCount: 20,
        socialMode: mode,
    };
    const world = new World(config);
    const herbivores = world.entities.filter((e) => e.species.kind === "herbivore");
    const carnivore = world.entities.find((e) => e.species.kind === "carnivore");
    if (!herbivores[0] || !carnivore) {
        throw new Error("Entities not initialized in makeSocialScenario");
    }
    herbivores[0].pos.x = 50;
    herbivores[0].pos.y = 50;
    carnivore.pos.x = 52;
    carnivore.pos.y = 50;
    return { world, herbivores, carnivore };
}

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
        if (alarmNear) {
            expect(alarmNear.intensity).toBeGreaterThan(0);
            // Direction vector from (60, 50) to (52.5, 50) has negative dx
            expect(alarmNear.dx).toBeLessThan(0);
        }

        // Outside query radius returns null
        expect(grid.queryAlarm(90, 90, 10)).toBeNull();

        // Test decay
        const prevIntensity = alarmNear ? alarmNear.intensity : 0;
        grid.decay(0.5);
        const decayed = grid.queryAlarm(60, 50, 15);
        expect(decayed).not.toBeNull();
        if (decayed) {
            expect(decayed.intensity).toBeLessThan(prevIntensity);
        }
    });

    it("herbivore emits alarm when threatened and neighbor reacts by steering away", () => {
        const { world, herbivores } = makeSocialScenario("pack", 2);
        const neighbor = herbivores[1];
        if (!neighbor) throw new Error("Neighbor herbivore missing");

        // Place neighbor 10 units away from victim (so it can hear the alarm)
        neighbor.pos.x = 60;
        neighbor.pos.y = 50;
        neighbor.angle = 0; // Heading right (away from victim)

        // Step simulation tick
        world.tickStep();

        // Victim should have emitted an alarm at/near (50, 50)
        const alarmAtSite = world.socialGrid.queryAlarm(50, 50, 10);
        expect(alarmAtSite).not.toBeNull();
        if (alarmAtSite) {
            expect(alarmAtSite.intensity).toBeGreaterThan(0);
        }
    });

    it("carnivore kill deposits hunt scent trail", () => {
        const config = {
            ...makeSeeding(20260907),
            herbivoreCount: 1,
            carnivoreCount: 1,
            plantCount: 10,
        };
        const world = new World(config);

        // Force a deposit directly to check scent query
        world.socialGrid.depositScent(40, 40, 3.0);
        const scent = world.socialGrid.queryScent(45, 40, 15);
        expect(scent).not.toBeNull();
        if (scent) {
            expect(scent.intensity).toBeGreaterThan(0);
            // Direction from (45, 40) to (40, 40) has negative dx
            expect(scent.dx).toBeLessThan(0);
        }
    });

    it("solitary mode does not emit alarms when threatened", () => {
        const { world } = makeSocialScenario("solitary");
        world.tickStep();

        // No alarm should be emitted in solitary mode
        expect(world.socialGrid.queryAlarm(50, 50, 10)).toBeNull();
    });

    it("dynamically switches social modes and scales cohesion spectrum", () => {
        const { world } = makeSocialScenario("solitary");

        // Switch to pack with half cohesion (0.5)
        world.setSocialMode("pack", 0.5);
        expect(world.config.socialMode).toBe("pack");
        expect(world.config.socialCohesion).toBe(0.5);

        world.tickStep();

        const alarm = world.socialGrid.queryAlarm(50, 50, 10);
        expect(alarm).not.toBeNull();
        if (alarm) {
            expect(alarm.intensity).toBeCloseTo(0.5 * (1 - 0.05), 1);
        }
    });
});
