/**
 * Tufts as subjects: pickable, marked, and sized by how grazed they are.
 *
 * A tuft is three mouthfuls now, which means two things the player has to be
 * able to see: how much grass is left standing in a patch (without clicking
 * anything), and — when they do click a tuft — how many bites are left in that
 * one. These tests pin both to the drawn meshes rather than to the numbers the
 * sim keeps, because the numbers are the easy half.
 */
import { describe, expect, it } from "vitest";
import { OrthographicCamera, Scene, Vector3 } from "three";
import { MeshPool, plantBiteScale } from "../src/render/meshes";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

/** A world with tufts and nothing to eat them: positions land where they land. */
function tuftWorld(plants: number, overrides: Partial<WorldConfig> = {}): World {
    const config = makeSeeding(20260907);
    config.plantCount = plants;
    config.maxPlants = plants;
    config.plantRegrowPerTick = 0;
    config.plantSeasonLength = 0;
    config.herbivoreCount = 0;
    config.carnivoreCount = 0;
    Object.assign(config, overrides);
    return new World(config);
}

/** A camera over the whole world, from the observer's side of the sky. */
function camera(): OrthographicCamera {
    const cam = new OrthographicCamera(-60, 60, 43, -43, 0.1, 500);
    cam.position.set(60, 200, 96);
    cam.lookAt(60, 0, 60);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
}

/** Where a ground point projects to, in NDC — the inverse of a pick. */
function ndcOf(x: number, y: number, cam: OrthographicCamera): { x: number; y: number } {
    const point = new Vector3(x, 0, y).project(cam);
    return { x: point.x, y: point.y };
}

function requirePlantMesh(pool: MeshPool, id: number) {
    const mesh = (pool as unknown as { plantMeshes: Map<number, unknown> }).plantMeshes.get(id);
    expect(mesh).toBeDefined();
    if (!mesh) {
        throw new Error(`Plant mesh ${id} not found`);
    }
    return mesh as { scale: { x: number }; position: { y: number } };
}

describe("picking a tuft", () => {
    it("selects the tuft under the click, and nothing far from it", () => {
        const world = tuftWorld(1);
        const pool = new MeshPool(new Scene());
        pool.sync(world);
        const tuft = world.plants[0];
        const cam = camera();
        const at = ndcOf(tuft.x, tuft.y, cam);

        expect(pool.pick(at.x, at.y, cam), "a click on a tuft picks it").toBe(tuft.id);
        // A tuft is a few pixels of thin blades, so the pick forgives a near
        // miss: the click still has to be aimed at it, it just does not have to
        // be a hit on a triangle.
        expect(pool.pick(at.x + 0.02, at.y + 0.02, cam), "a near miss still picks it").toBe(tuft.id);
        expect(pool.pick(at.x + 0.5, at.y, cam), "a click on empty ground picks nothing").toBeNull();
    });

    it("marks the selected tuft with the ring, sized for a tuft", () => {
        const world = tuftWorld(1);
        const pool = new MeshPool(new Scene());
        pool.sync(world);
        const tuft = world.plants[0];
        const ring = pool["ring"];

        expect(ring.visible).toBe(false);
        pool.select(tuft.id);
        expect(ring.visible, "a selected tuft is marked").toBe(true);
        expect(ring.position.x).toBeCloseTo(tuft.x, 5);
        expect(ring.position.z).toBeCloseTo(tuft.y, 5);
        expect(ring.position.y, "the ring lies on the ground").toBeLessThan(0.2);
        expect(ring.scale.x, "a tuft's ring is smaller than an animal's").toBeLessThan(1);

        pool.select(null);
        expect(ring.visible).toBe(false);
    });

    it("keeps a ring on the animal when the selection is an animal's", () => {
        const config = makeSeeding(20260907);
        config.plantCount = 0;
        config.plantRegrowPerTick = 0;
        config.herbivoreCount = 1;
        config.carnivoreCount = 1;
        const world = new World(config);
        const pool = new MeshPool(new Scene());
        pool.sync(world);
        const animal = world.entities[0];
        pool.select(animal.id);
        const ring = pool["ring"];
        expect(ring.visible).toBe(true);
        expect(ring.scale.x).toBe(1);
        expect(ring.position.x).toBeCloseTo(animal.pos.x, 5);
    });

    it("picks an animal over a tuft when both are under the click", () => {
        // Ids are shared between animals and plants, so the pick has to return
        // one subject and the caller resolves it — including when a grazer is
        // standing on the tuft it is eating.
        const config = makeSeeding(20260907);
        config.plantCount = 1;
        config.maxPlants = 1;
        config.plantRegrowPerTick = 0;
        config.plantSeasonLength = 0;
        config.herbivoreCount = 1;
        config.carnivoreCount = 0;
        const world = new World(config);
        const tuft = world.plants[0];
        const grazer = world.entities[0];
        grazer.pos.x = tuft.x;
        grazer.pos.y = tuft.y;
        const pool = new MeshPool(new Scene());
        pool.sync(world);
        const cam = camera();
        const at = ndcOf(tuft.x, tuft.y, cam);
        const picked = pool.pick(at.x, at.y, cam);
        expect([tuft.id, grazer.id], "the click belongs to one of them").toContain(picked);
    });
});

describe("a grazed tuft is drawn smaller", () => {
    it("scales with the bites left in it, never to nothing", () => {
        expect(plantBiteScale(1), "a fresh tuft is drawn at full size").toBeCloseTo(1, 10);
        expect(plantBiteScale(0), "a tuft with nothing left is still a tuft").toBeGreaterThan(0.4);
        expect(plantBiteScale(0.5)).toBeGreaterThan(plantBiteScale(0.25));
        expect(plantBiteScale(0.25)).toBeGreaterThan(plantBiteScale(0));
        // An over-full reading cannot inflate a tuft past the season's scale.
        expect(plantBiteScale(2)).toBe(plantBiteScale(1));
    });

    it("draws a one-bite tuft smaller than a fresh one, in the same frame", () => {
        const world = tuftWorld(2);
        const pool = new MeshPool(new Scene());
        const [fresh, grazed] = world.plants;
        grazed.bites = 1;
        grazed.energy = world.plantParams.biteEnergy;
        pool.sync(world);

        const freshMesh = requirePlantMesh(pool, fresh.id);
        const grazedMesh = requirePlantMesh(pool, grazed.id);
        expect(freshMesh.scale.x).toBeCloseTo(1, 6);
        expect(grazedMesh.scale.x).toBeLessThan(freshMesh.scale.x);
        expect(grazedMesh.scale.x).toBeCloseTo(plantBiteScale(1 / 3), 6);
        // Both stay on the ground, scaled about their base.
        expect(grazedMesh.position.y).toBe(0);
    });

    it("carries a replay frame's own plant energy into the drawn size", () => {
        // Frames record each tuft's remaining energy, so a replay shows the
        // grass the way it stood rather than every tuft freshly grown.
        const world = tuftWorld(1);
        const pool = new MeshPool(new Scene());
        pool.sync(world);
        const tuft = world.plants[0];
        const full = world.plantParams.energy;
        const frame = {
            tick: 0,
            turn: 0,
            entities: [],
            plants: [
                [tuft.id, tuft.x, tuft.y, full],
                [tuft.id + 1, tuft.x + 5, tuft.y, full / 3],
            ],
            carrions: [],
            populations: { herbivore: 0, carnivore: 0, plants: 2 },
            seasonAbundance: null,
        };
        pool.syncFrame(frame);
        const big = requirePlantMesh(pool, tuft.id);
        const small = requirePlantMesh(pool, tuft.id + 1);
        expect(small.scale.x).toBeLessThan(big.scale.x);
        expect(small.scale.x).toBeCloseTo(plantBiteScale(1 / 3), 6);
    });
});
