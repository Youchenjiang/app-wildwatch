/**
 * The props' silhouettes, measured rather than eyeballed.
 *
 * Plants and corpses used to be a cylinder and a sphere. The sphere is the
 * worst possible choice for a corpse: a living animal is a sphere too, so at the
 * default framing a kill and the body standing over it differed only in hue —
 * and hue is the first thing the fog and the seasonal tint take away. These
 * tests pin the shapes as geometry, so "a corpse does not look like an animal"
 * cannot silently regress into a comment.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
    CARRION_SHAPE,
    MeshPool,
    PLANT_SHAPE,
    animalGeometry,
    buildCarrionGeometry,
    buildPlantGeometry,
} from "../src/render/meshes";
import type { SpeciesKind } from "../src/sim/types";
import { World } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";

const SPECIES: SpeciesKind[] = ["herbivore", "carnivore"];

/** Bounding box of a geometry in its own frame. */
function extents(geometry: THREE.BufferGeometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    return {
        width: box.max.x - box.min.x,
        height: box.max.y - box.min.y,
        depth: box.max.z - box.min.z,
        minY: box.min.y,
        /** How far it reaches out sideways, whichever side is further. */
        reach: Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
    };
}

/**
 * How tall a thing reads from above: its height over the wider side of its
 * ground footprint. This is the number that decides whether a player sees a
 * standing body, a tuft, or something lying flat.
 */
function aspect(geometry: THREE.BufferGeometry): number {
    const box = extents(geometry);
    return box.height / Math.max(box.width, box.depth);
}

/** The same reading for a mesh as drawn, pose scale included. */
function drawnAspect(mesh: THREE.Mesh): number {
    const box = extents(mesh.geometry);
    return (
        (box.height * Math.abs(mesh.scale.y)) /
        Math.max(box.width * Math.abs(mesh.scale.x), box.depth * Math.abs(mesh.scale.z))
    );
}

describe("corpse silhouette", () => {
    it("is at least twice as flat as any living animal", () => {
        const corpse = buildCarrionGeometry();
        expect(aspect(corpse), "flat enough to read as a body on the ground").toBeLessThan(0.32);

        for (const kind of SPECIES) {
            const living = animalGeometry(kind);
            expect(aspect(living), `${kind} stands up`).toBeGreaterThan(0.5);
            // Flatter than the *narrowest* living body, not just the round one:
            // the carnivore is long and low, and a corpse has to beat that too.
            expect(aspect(living) / aspect(corpse), `${kind} versus a corpse`).toBeGreaterThan(2);
        }
    });

    it("breaks its outline with splayed limbs and a ridged spine", () => {
        const corpse = buildCarrionGeometry();
        const { slab, ribs } = CARRION_SHAPE;
        // Limbs reach out past the slab itself, so the outline is not the oval a
        // living body leaves behind.
        expect(extents(corpse).reach).toBeGreaterThan(slab[0] * 1.2);

        // Ribs stand above the slab's own top, in separate places along it: a
        // smooth mound would have none.
        const position = corpse.attributes.position;
        const along: number[] = [];
        for (let idx = 0; idx < position.count; idx++) {
            if (position.getY(idx) > slab[1] * 2) along.push(position.getZ(idx));
        }
        expect(along.length, "nothing rises above the slab").toBeGreaterThan(0);
        const bins = new Set(along.map((zCoord) => Math.round((zCoord + ribs.span) / (ribs.span / 2))));
        expect(bins.size, "the ridge is one lump, not a spine").toBeGreaterThanOrEqual(ribs.count);
    });

    it("rests on the ground at every stage of its decay", () => {
        // The pool places a corpse at y = 0 and squashes it by its remaining
        // mass, so a geometry that does not start at y = 0 either hovers or
        // sinks — and it would do so differently at each stage of decay.
        expect(extents(buildCarrionGeometry()).minY).toBeCloseTo(0, 6);
    });
});

describe("plant silhouette", () => {
    it("is a tuft that grows upward, not a solid lump", () => {
        const plant = buildPlantGeometry();
        const box = extents(plant);
        expect(aspect(plant), "taller than it is wide").toBeGreaterThan(1.1);
        expect(box.minY, "rooted in the ground").toBeCloseTo(0, 6);

        for (const kind of SPECIES) {
            // The contrast that survives the god camera: the tuft is the tall
            // outline, every animal sits in the middle, a corpse is the flat one.
            expect(aspect(plant) / aspect(animalGeometry(kind)), `${kind} versus a tuft`).toBeGreaterThan(
                1.2,
            );
        }
    });

    it("leaves gaps between the blades instead of a cone", () => {
        const plant = buildPlantGeometry();
        const position = plant.attributes.position;
        // Only the part above the stump: that is where the blades separate.
        const bins = new Set<number>();
        for (let idx = 0; idx < position.count; idx++) {
            if (position.getY(idx) <= PLANT_SHAPE.stumpHeight) continue;
            const angle = Math.atan2(position.getX(idx), position.getZ(idx));
            // Half-bin offset, so a blade pointing straight down an axis is not
            // split across two bins and counted twice.
            const bin = Math.floor(((angle + Math.PI + Math.PI / 24) / (Math.PI * 2)) * 24) % 24;
            bins.add(bin);
        }
        const sorted = [...bins].sort((valA, valB) => valA - valB);
        // A cone's vertices sweep every direction; a tuft's blades each sit in
        // their own wedge, with empty wedges between them.
        let wedges = sorted.length > 0 ? 1 : 0;
        for (let step = 1; step < sorted.length; step++) {
            if (sorted[step] !== sorted[step - 1] + 1) wedges++;
        }
        expect(wedges, "the blades do not separate around the stem").toBeGreaterThanOrEqual(
            PLANT_SHAPE.blades,
        );
        expect(
            sorted.length / Math.max(1, wedges),
            "each blade smeared around the stem rather than staying a blade",
        ).toBeLessThanOrEqual(3);
    });
});

describe("props as drawn", () => {
    it("gives both a tint per part, so the shape reads in flat light", () => {
        for (const geometry of [buildPlantGeometry(), buildCarrionGeometry()]) {
            const color = geometry.attributes.color;
            expect(color, "the materials multiply vertex colours").toBeTruthy();
            let min = Infinity;
            let max = -Infinity;
            for (let idx = 0; idx < color.count; idx++) {
                min = Math.min(min, color.getX(idx));
                max = Math.max(max, color.getX(idx));
            }
            expect(max - min, "one flat tint would flatten the parts together").toBeGreaterThan(0.1);
        }
        const pool = new MeshPool(new THREE.Scene());
        expect(pool["plantMaterial"].vertexColors).toBe(true);
        expect(pool["carrionMaterial"].vertexColors).toBe(true);
    });

    it("stands a synced plant and corpse on the ground, at their own shapes", () => {
        const world = new World(makeSeeding(4));
        const pool = new MeshPool(new THREE.Scene());
        // A corpse is what a death leaves; planting one directly keeps this
        // about the drawing rather than about how long a hunt takes.
        world.carrions.push({
            id: 9999,
            x: 12,
            y: 9,
            energy: 40,
            alive: true,
            fromId: 0,
            fromGeneration: 1,
        });
        pool.sync(world);

        const plants = [...pool["plantMeshes"].values()];
        expect(plants.length).toBeGreaterThan(0);
        for (const mesh of plants) {
            expect(mesh.position.y, "a plant's base belongs on the ground").toBe(0);
            expect(mesh.geometry).toBe(pool["plantGeometry"]);
            expect(mesh.material).toBe(pool["plantMaterial"]);
        }

        const corpses = [...pool["carrionMeshes"].values()];
        expect(corpses).toHaveLength(1);
        const corpse = corpses[0];
        expect(corpse.position.x).toBeCloseTo(12, 5);
        expect(corpse.position.y, "a corpse belongs on the ground").toBe(0);
        expect(corpse.geometry).toBe(pool["carrionGeometry"]);

        // The claim the player actually sees: a corpse is a flat bar next to a
        // standing body, while still being body-sized rather than a speck.
        const living = [...pool["npcMeshes"].values()][0];
        expect(living, "the world has something alive in it").toBeTruthy();
        expect(drawnAspect(corpse) * 2).toBeLessThan(drawnAspect(living));
        expect(extents(corpse.geometry).width * corpse.scale.x).toBeGreaterThan(
            extents(living.geometry).width * 0.5,
        );
    });
});
