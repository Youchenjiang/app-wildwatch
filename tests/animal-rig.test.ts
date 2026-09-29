/**
 * The gait deforms the body and only the body.
 *
 * The stride used to scale one merged mesh, so a running animal's snout
 * stretched and shrank with its body — and the snout is the part that reads the
 * heading from above, so it was the part that wobbled most. These tests pin the
 * split: the body still breathes, while the snout, tail, ears and crest hold
 * their shape, measured both as geometry and as the transforms the pool draws.
 */
import { describe, expect, it } from "vitest";
import { Box3, BufferGeometry, Mesh, Object3D, Scene, Vector3 } from "three";
import { GAIT_RATE, MeshPool, animalGeometry, animalParts } from "../src/render/meshes";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import type { SpeciesKind } from "../src/sim/types";

const SPECIES: SpeciesKind[] = ["herbivore", "carnivore"];

/** Body radii per species, for checking where a rig's pivot sits. */
const BODY: Record<SpeciesKind, readonly [number, number, number]> = {
    herbivore: [0.8, 0.7, 0.62],
    carnivore: [0.44, 0.7, 0.92],
};

/** A wall-clock time at which this animal's stride wave is exactly `sign`. */
function timeForWave(id: number, sign: 1 | -1): number {
    const phase = (sign * Math.PI) / 2 - id * 1.7;
    const laps = Math.ceil(-phase / (Math.PI * 2));
    return (phase + laps * Math.PI * 2) / GAIT_RATE;
}

/** Bounding box of a geometry in its own frame. */
function localBox(geometry: BufferGeometry): Box3 {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    return box ? box.clone() : new Box3();
}

/** The three scales a mesh is actually drawn at, read off its world matrix. */
function drawnScales(mesh: Object3D): [number, number, number] {
    mesh.updateWorldMatrix(true, false);
    const elements = mesh.matrixWorld.elements;
    return [
        Math.hypot(elements[0], elements[1], elements[2]),
        Math.hypot(elements[4], elements[5], elements[6]),
        Math.hypot(elements[8], elements[9], elements[10]),
    ];
}

/** The world-space size of a mesh's own geometry: what the player sees. */
function drawnSize(mesh: Mesh): Vector3 {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.attributes.position;
    const point = new Vector3();
    const box = new Box3();
    for (let idx = 0; idx < position.count; idx++) {
        box.expandByPoint(point.fromBufferAttribute(position, idx).applyMatrix4(mesh.matrixWorld));
    }
    return box.getSize(new Vector3());
}

/** The animal's size in world units, as the pool computes it from its energy. */
function bodyScale(entity: { energy: number; species: { maxEnergy: number } }): number {
    return 0.6 + 0.8 * Math.min(1, entity.energy / entity.species.maxEnergy);
}

/** One live animal of the given species, with a pool drawing it. */
function subjectOf(kind: SpeciesKind) {
    const world = new World(makeSeeding(7));
    const subject = world.entities.find((entity) => entity.alive && entity.species.kind === kind);
    expect(subject, `no live ${kind} to draw`).toBeTruthy();
    if (!subject) throw new Error(`no live ${kind} to draw`);
    const pool = new MeshPool(new Scene());
    const animal = (): Mesh => pool["npcMeshes"].get(subject.id) as Mesh;
    const rig = (): Mesh => animal().children[0] as Mesh;
    return { world, subject, pool, animal, rig };
}

describe("the body strides", () => {
    for (const kind of SPECIES) {
        it(`deforms the ${kind}'s body and leaves the rest of it alone`, () => {
            const { world, subject, pool, animal, rig } = subjectOf(kind);
            const scale = bodyScale(subject);
            const anchor = animalParts(kind).anchor;

            // Rest: nothing has travelled yet, so the stride is off and the
            // animal is drawn exactly as it was authored.
            pool.sync(world, null, 0);
            expect(rig().scale.toArray(), "a still animal's rig is untransformed").toEqual([1, 1, 1]);
            expect(rig().position.toArray(), "the rig sits on the point it pivots on").toEqual([
                anchor.x,
                anchor.y,
                anchor.z,
            ]);
            const restBody = drawnScales(animal());
            const rigSizeAtRest = drawnSize(rig());

            // Stride: move the animal, then draw it at the top of the wave, and
            // again at the bottom. Any real travel drives a full stride, so the
            // body is as stretched as it gets and then as squashed.
            subject.pos.x += 1;
            pool.sync(world, null, timeForWave(subject.id, 1));
            const stretchedBody = drawnScales(animal());
            const stretchedRig = drawnScales(rig());
            const stretchSize = drawnSize(rig());

            subject.pos.x += 1;
            pool.sync(world, null, timeForWave(subject.id, -1));
            const squashedBody = drawnScales(animal());
            const squashedRig = drawnScales(rig());

            // The body really is striding: taller and thinner, then shorter and
            // wider, by a margin far outside floating-point noise.
            expect(stretchedBody[1], "the body stretches").toBeGreaterThan(restBody[1] * 1.1);
            expect(stretchedBody[0], "and thins").toBeLessThan(restBody[0] * 0.99);
            expect(squashedBody[1], "the body squashes").toBeLessThan(restBody[1] * 0.9);
            expect(squashedBody[0], "and widens").toBeGreaterThan(restBody[0] * 1.01);
            expect(stretchedBody[0]).toBeCloseTo(stretchedBody[2], 12);

            // The rig does not deform at all: it is drawn at the animal's own
            // size, uniformly, at both extremes of the stride.
            for (const [frame, scales] of [
                ["stretched", stretchedRig],
                ["squashed", squashedRig],
            ] as const) {
                expect(scales[0], `${frame}: across`).toBeCloseTo(scale, 9);
                expect(scales[1], `${frame}: up`).toBeCloseTo(scale, 9);
                expect(scales[2], `${frame}: along`).toBeCloseTo(scale, 9);
            }

            // Which is the part the player sees: the snout reaches exactly as
            // far as it does at rest, so the heading it draws cannot wobble.
            const rigSize = drawnSize(rig());
            expect(rigSize.x).toBeCloseTo(rigSizeAtRest.x, 9);
            expect(rigSize.y).toBeCloseTo(rigSizeAtRest.y, 9);
            expect(rigSize.z).toBeCloseTo(rigSizeAtRest.z, 9);
            expect(stretchSize.z).toBeCloseTo(rigSizeAtRest.z, 9);

            // And the body's drawn size really did move, so the contrast above
            // is telling us something.
            expect(Math.abs(stretchedBody[1] - restBody[1])).toBeGreaterThan(0.05);
        });
    }
});

describe("the split silhouette", () => {
    for (const kind of SPECIES) {
        it(`draws the ${kind} exactly as the merged rest pose`, () => {
            // The two parts are one animal: the same vertices, in the same
            // places, under two transforms instead of one. If they ever drift
            // apart, the silhouette tests would be measuring something the pool
            // does not draw.
            const merged = animalGeometry(kind);
            const { body, appendages, anchor } = animalParts(kind);
            expect(body.attributes.position.count + appendages.attributes.position.count).toBe(
                merged.attributes.position.count,
            );

            const union = localBox(body).union(
                localBox(appendages).translate(new Vector3(anchor.x, anchor.y, anchor.z)),
            );
            const whole = localBox(merged);
            const rounded = (box: Box3) => ({
                min: box.min.toArray().map((v) => Math.round(v * 1e6)),
                max: box.max.toArray().map((v) => Math.round(v * 1e6)),
            });
            expect(rounded(union)).toEqual(rounded(whole));
        });

        it(`pivots the ${kind}'s rig where its features are planted`, () => {
            // The rig rides this point, so it has to be on the body: a pivot off
            // the surface would carry the whole rig away from it.
            const { anchor } = animalParts(kind);
            const [bodyX, bodyY, bodyZ] = BODY[kind];
            const inside =
                (anchor.x / bodyX) ** 2 + (anchor.y / bodyY) ** 2 + (anchor.z / bodyZ) ** 2;
            expect(inside, "the pivot is off the body").toBeLessThanOrEqual(1.001);
            // And up where the features stand, not on the ground: the surface
            // near the floor moves least, so a rig pivoted down there would
            // leave the ears and any crest behind as the body squashes under
            // them.
            expect(anchor.y).toBeGreaterThan(0.2);
        });
    }
});
