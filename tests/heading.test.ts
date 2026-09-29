import { describe, expect, it } from "vitest";
import { BufferGeometry, Mesh, Scene, Vector3 } from "three";
import { MeshPool } from "../src/render/meshes";
import type { ReplayFrame } from "../src/observe/replay";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import type { Entity } from "../src/sim/entity";

/** The animal's leading vertex in its own frame: the tip of the snout. */
function snoutTip(geometry: BufferGeometry): Vector3 {
    const position = geometry.attributes.position;
    const tip = new Vector3();
    let frontmost = -Infinity;
    for (let i = 0; i < position.count; i++) {
        if (position.getZ(i) > frontmost) {
            frontmost = position.getZ(i);
            tip.set(position.getX(i), position.getY(i), position.getZ(i));
        }
    }
    return tip;
}

/**
 * Where a mesh's snout actually lands, in scene (x, z), as drawn.
 *
 * The snout is part of the rigid feature rig, which is a child of the body, so
 * the tip has to be read through that child's own matrix: it carries the
 * heading and whatever stride the body has, and holds the snout rigid against
 * it.
 */
function drawnSnout(pool: MeshPool, entity: Entity): { x: number; z: number; length: number } {
    const mesh = pool["npcMeshes"].get(entity.id);
    if (!mesh) throw new Error(`mesh not found for entity ${entity.id}`);
    mesh.updateMatrixWorld(true);
    const rig = mesh.children[0] as Mesh;
    const tip = snoutTip(rig.geometry).applyMatrix4(rig.matrixWorld).sub(mesh.position);
    return { x: tip.x, z: tip.z, length: Math.hypot(tip.x, tip.z) };
}

describe("rendered heading", () => {
    it("points the snout the way the animal is heading, not 90 degrees off", () => {
        // The simulation's heading is (cos angle, sin angle) in (x, y), and the
        // scene maps sim y to scene z, so the drawn snout must land on exactly
        // that vector. It is worth pinning because three.js turns a mesh's +Z
        // toward +X, which is a reflection of the sim's convention: the two
        // agree only when an animal happens to be heading along a diagonal.
        const world = new World(makeSeeding(20260907));
        const pool = new MeshPool(new Scene());
        for (let idx = 0; idx < 200; idx++) world.tickStep();

        const before = new Map<number, { x: number; y: number }>(
            world.entities.map((entity) => [entity.id, { x: entity.pos.x, y: entity.pos.y }]),
        );
        world.tickStep();
        pool.sync(world);

        let checked = 0;
        let bounced = 0;
        for (const entity of world.entities) {
            const from = before.get(entity.id);
            if (!entity.alive || !from) continue;
            const travelled = Math.hypot(entity.pos.x - from.x, entity.pos.y - from.y);
            if (travelled < 0.5) continue; // standing still: nothing to compare
            // Hitting a wall re-aims the animal after it has already moved
            // (rule 7), so travel and heading legitimately disagree there.
            const headX = Math.cos(entity.angle);
            const headY = Math.sin(entity.angle);
            if ((headX * (entity.pos.x - from.x) + headY * (entity.pos.y - from.y)) / travelled < 0.99) {
                bounced++;
                continue;
            }

            const snout = drawnSnout(pool, entity);
            expect(snout.length, "the animal lost its snout").toBeGreaterThan(0.3);
            expect(snout.x / snout.length).toBeCloseTo(headX, 6);
            expect(snout.z / snout.length).toBeCloseTo(headY, 6);
            checked++;
        }

        expect(checked, "no animal heading anywhere was actually checked").toBeGreaterThan(5);
        expect(bounced, "the whole population was against the walls").toBeLessThan(5);
    });

    it("carries the heading into the replay frames as well", () => {
        // A replay row stores the same angle the live world drew, so scrubbing
        // must show the same animal facing the same way.
        const world = new World(makeSeeding(20260907));
        const pool = new MeshPool(new Scene());
        for (let idx = 0; idx < 200; idx++) world.tickStep();
        const living = world.entities.filter((entity) => entity.alive).slice(0, 20);
        const frame: ReplayFrame = {
            tick: world.tick,
            turn: world.turn,
            entities: living.map((entity) => [
                entity.id,
                entity.species.kind === "herbivore" ? 0 : 1,
                entity.pos.x,
                entity.pos.y,
                entity.angle,
                0.5,
                entity.generation,
            ]),
            plants: [],
            carrions: [],
            populations: { herbivore: 0, carnivore: 0, plants: 0 },
            seasonAbundance: null,
        };
        pool.syncFrame(frame);
        for (const entity of living) {
            const snout = drawnSnout(pool, entity);
            expect(snout.length, "the replayed animal lost its snout").toBeGreaterThan(0.3);
            expect(snout.x / snout.length).toBeCloseTo(Math.cos(entity.angle), 6);
            expect(snout.z / snout.length).toBeCloseTo(Math.sin(entity.angle), 6);
        }
    });
});
