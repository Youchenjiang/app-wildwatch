import { describe, expect, it } from "vitest";
import { World, type Carrion, type Plant } from "../src/sim/world";
import { SpatialGrid } from "../src/sim/spatial-grid";
import { makeSeeding } from "../src/sim/seeding";
import type { Entity } from "../src/sim/entity";

type Pointed = { x: number; y: number };

/** The world's indexes, without widening their public API for a test. */
function indexes(world: World) {
    return {
        entity: world["grid"] as SpatialGrid<Entity>,
        plant: world["plantGrid"] as SpatialGrid<Plant>,
        carrion: world["carrionGrid"] as SpatialGrid<Carrion>,
    };
}

/**
 * Probe points that actually exercise ordering: every living thing's own
 * position, so each query lands in a dense neighbourhood, plus the corners,
 * where positions get clamped to identical values and exact ties are possible.
 */
function probes(where: readonly Pointed[]): Pointed[] {
    const points: Pointed[] = [
        { x: 0.5, y: 0.5 },
        { x: 119.5, y: 119.5 },
        { x: 0.5, y: 119.5 },
        { x: 119.5, y: 0.5 },
        { x: 60, y: 60 },
    ];
    for (const p of where) points.push({ x: p.x, y: p.y });
    return points;
}

const RADII = [0, 1, 3, 4, 10, 14, 30];

/** Compare a live index against a full rebuild, order included. */
function expectMatchesRebuild<T extends { id: number }>(
    live: SpatialGrid<T>,
    items: readonly T[],
    position: (item: T) => Pointed,
    where: string,
): void {
    const fresh = new SpatialGrid<T>(10, position);
    for (const item of items) fresh.insert(item);
    for (const p of probes(items.map(position))) {
        for (const r of RADII) {
            const got: T[] = [];
            const want: T[] = [];
            live.query(p.x, p.y, r, got);
            fresh.query(p.x, p.y, r, want);
            expect(
                got.map((i) => i.id),
                `${where} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) r=${r}`,
            ).toEqual(want.map((i) => i.id));
        }
    }
}

describe("in-place index maintenance", () => {
    it(
        "agrees with a full rebuild at the point in the tick the rebuild ran",
        () => {
            // The comparison has to happen exactly where the rebuild used to:
            // at the tick's sync point. A tick later, the index deliberately
            // still holds start-of-tick positions (queries within a tick must
            // see the world as it was when the tick began), so comparing after
            // a tick would be comparing against the wrong thing.
            const world = new World(makeSeeding(20260907));
            for (let i = 0; i < 700; i++) world.tickStep();

            const grid = indexes(world);
            const sync = world["syncIndexes"].bind(world);
            let syncs = 0;
            world["syncIndexes"] = (): void => {
                sync();
                // Check every sync, so a divergence cannot hide between samples.
                syncs++;
                expectMatchesRebuild(
                    grid.entity,
                    world.entities.filter((e) => e.alive),
                    (e) => e.pos,
                    "entities",
                );
                expectMatchesRebuild(grid.plant, world.plants, (p) => p, "plants");
                expectMatchesRebuild(grid.carrion, world.carrions, (c) => c, "carrions");
            };
            for (let i = 0; i < 400; i++) world.tickStep();
            expect(syncs).toBe(400);
        },
        120000,
    );

    it(
        "holds the living things, and only them, tick after tick",
        () => {
            // A rebuild cannot hold a phantom; an in-place index can, if a death
            // forgets to unhook. The count is exact once the deferral rule is
            // accounted for: anything created during a tick is not filed until
            // the next tick's sync, which is where the rebuild used to run.
            const world = new World(makeSeeding(20260907));
            const grid = indexes(world);
            for (let i = 0; i < 3000; i++) {
                const entitiesBefore = new Set(world.entities);
                const carrionsBefore = new Set(world.carrions);
                world.tickStep();
                if (i % 500 !== 0) continue;

                const bornAlive = world.entities.filter(
                    (e) => !entitiesBefore.has(e) && e.alive,
                ).length;
                const newCarrions = world.carrions.filter((c) => !carrionsBefore.has(c)).length;
                expect(grid.entity.size).toBe(
                    world.entities.filter((e) => e.alive).length - bornAlive,
                );
                // Plants have no deferral: they are filed as they regrow, since
                // the rebuild also ran after regrowth.
                expect(grid.plant.size).toBe(world.plants.length);
                expect(grid.carrion.size).toBe(world.carrions.length - newCarrions);
            }
        },
        120000,
    );

    it(
        "defers filing a newborn until the tick after it is born",
        () => {
            // An animal born mid-tick was invisible to every query in that tick,
            // because the rebuild ran at the previous sweep. Filing at birth
            // instead would let a predator take a child the instant it
            // appeared, while its parent was still being chased.
            const world = new World(makeSeeding(20260907));
            const grid = indexes(world);
            let born: Entity[] = [];
            for (let i = 0; i < 300 && born.length === 0; i++) {
                const before = new Set(world.entities);
                world.tickStep();
                born = world.entities.filter((e) => e.alive && !before.has(e));
            }
            expect(born.length, "no birth in 300 ticks of grassland").toBeGreaterThan(0);
            for (const baby of born) {
                expect(grid.entity.has(baby), "a newborn is filed in its birth tick").toBe(false);
            }
            world.tickStep();
            for (const baby of born) {
                if (baby.alive) expect(grid.entity.has(baby)).toBe(true);
            }
        },
        120000,
    );
});
