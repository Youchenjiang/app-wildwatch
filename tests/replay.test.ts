import { describe, expect, it } from "vitest";
import { ReplayRecorder } from "../src/observe/replay";
import { makeSeeding } from "../src/sim/seeding";
import { World } from "../src/sim/world";

describe("ReplayRecorder", () => {
    it("captures frames without changing the deterministic run", () => {
        const makeWorld = () => new World({ ...makeSeeding(4242) });

        // Run A: no recorder.
        const a = makeWorld();
        for (let i = 0; i < 300; i++) a.tickStep();

        // Run B: same seed, observed.
        const b = makeWorld();
        const rec = new ReplayRecorder(10, 500);
        for (let i = 0; i < 300; i++) {
            b.tickStep();
            if (rec.shouldCapture(b.tick)) rec.capture(b);
        }

        expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
        expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id));
        expect(rec.size).toBe(30);
        const f = rec.latest();
        expect(f).not.toBeNull();
        expect(f!.tick).toBe(300);
        expect(f!.populations.herbivore).toBe(b.populationOf("herbivore"));
        expect(f!.populations.carnivore).toBe(b.populationOf("carnivore"));
    });

    it("honors the ring buffer capacity", () => {
        const world = new World({ ...makeSeeding(77) });
        const rec = new ReplayRecorder(5, 20);
        for (let i = 0; i < 500 && world.gameOver === null; i++) {
            world.tickStep();
            if (rec.shouldCapture(world.tick)) rec.capture(world);
        }
        expect(rec.size).toBeLessThanOrEqual(20);
        expect(rec.stats().frames).toBe(rec.size);
    });
});
