import { describe, expect, it } from "vitest";
import { ReplayRecorder } from "../src/observe/replay";
import { makeSeeding } from "../src/sim/seeding";
import { seasonAbundanceAt, World } from "../src/sim/world";

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
        if (f) {
            expect(f.tick).toBe(300);
            expect(f.populations.herbivore).toBe(b.populationOf("herbivore"));
            expect(f.populations.carnivore).toBe(b.populationOf("carnivore"));
        }
    });

    it("carries the season position of each captured tick", () => {
        const season = makeSeeding(4242);
        const world = new World(season);
        const rec = new ReplayRecorder(10, 500);
        for (let i = 0; i < 300; i++) {
            world.tickStep();
            if (rec.shouldCapture(world.tick)) rec.capture(world);
        }

        // Seasons are on in the default seeding: every frame carries a 0..1
        // abundance matching the exact tick it was captured at.
        const f0 = rec.frameAt(0);
        const f10 = rec.frameAt(10);
        const latest = rec.latest();
        expect(f0).not.toBeNull();
        expect(f10).not.toBeNull();
        expect(latest).not.toBeNull();
        if (f0 && f10 && latest) {
            const frames = [f0, f10, latest];
            const seasonLen = season.plantSeasonLength ?? 0;
            const seasonDepth = season.plantSeasonDepth ?? 0;
            for (const f of frames) {
                expect(f.seasonAbundance).not.toBeNull();
                const sa = f.seasonAbundance;
                if (sa !== null) {
                    expect(sa).toBeGreaterThanOrEqual(0);
                    expect(sa).toBeLessThanOrEqual(1);
                    expect(sa).toBeCloseTo(
                        seasonAbundanceAt(f.tick, seasonLen, seasonDepth),
                        5,
                    );
                }
            }
        }
    });

    it("records null season when seasons are disabled", () => {
        const world = new World({ ...makeSeeding(4242), plantSeasonLength: 0 });
        const rec = new ReplayRecorder(10, 500);
        for (let i = 0; i < 30; i++) {
            world.tickStep();
            if (rec.shouldCapture(world.tick)) rec.capture(world);
        }
        const latest = rec.latest();
        expect(latest).not.toBeNull();
        expect(latest?.seasonAbundance).toBeNull();
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
