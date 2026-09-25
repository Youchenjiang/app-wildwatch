import { describe, expect, it } from "vitest";
import { MeshPool } from "../src/render/meshes";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import * as THREE from "three";

function camera(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(50, 2, 0.1, 500);
    cam.position.set(0, 60, 60);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    return cam;
}

function poolAndWorld(threshold: number, seed = 42): { pool: MeshPool; world: World } {
    const config: WorldConfig = {
        ...makeSeeding(seed),
        width: 30,
        height: 30,
        herbivoreCount: 0,
        carnivoreCount: 2,
        plantCount: 0,
        plantRegrowPerTick: 0,
        turnLength: 1,
        cannibalismThreshold: threshold,
    };
    const world = new World(config);
    const pool = new MeshPool(new THREE.Scene());
    return { pool, world };
}

describe("cannibalism indicator", () => {
    it("shows a pulsing ring above a starving carnivore", () => {
        const { pool, world } = poolAndWorld(0.15);
        const starver = world.entities[0]!;
        starver.energy = 1; // below 0.15 * 100 = 15
        const healthy = world.entities[1]!;
        healthy.energy = 80;

        pool.sync(world, null, 1.0);

        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        const ring = indicators.get(starver.id);
        expect(ring, "starving carnivore should have an indicator").toBeDefined();
        expect(ring!.visible).toBe(true);
        expect(ring!.position.y).toBeGreaterThan(0);

        // Healthy carnivore should have no indicator.
        expect(indicators.has(healthy.id)).toBe(false);
    });

    it("hides the ring once the carnivore recovers above the threshold", () => {
        const { pool, world } = poolAndWorld(0.15);
        const carn = world.entities[0]!;
        carn.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        expect(indicators.get(carn.id)!.visible).toBe(true);

        // Recover above threshold.
        carn.energy = 80;
        pool.sync(world, null, 2.0);
        expect(indicators.get(carn.id)!.visible).toBe(false);
    });

    it("does not create indicators when cannibalism is disabled (threshold = 0)", () => {
        const { pool, world } = poolAndWorld(0);
        const carn = world.entities[0]!;
        carn.energy = 1;

        pool.sync(world, null, 1.0);

        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        expect(indicators.size).toBe(0);
    });

    it("cleans up indicators when an animal dies", () => {
        const { pool, world } = poolAndWorld(0.15);
        const starver = world.entities[0]!;
        starver.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        expect(indicators.has(starver.id)).toBe(true);

        // Kill the animal and sync — indicator should be pruned.
        starver.alive = false;
        pool.sync(world, null, 2.0);
        expect(indicators.has(starver.id)).toBe(false);
    });

    it("pulse opacity changes over time", () => {
        const { pool, world } = poolAndWorld(0.15);
        const carn = world.entities[0]!;
        carn.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        const ring = indicators.get(carn.id)!;
        const mat = ring.material as THREE.MeshBasicMaterial;
        const op1 = mat.opacity;

        pool.sync(world, null, 2.0);
        const op2 = mat.opacity;

        expect(op1).not.toBeCloseTo(op2, 2);
    });

    it("cleans up all indicators on reset", () => {
        const { pool, world } = poolAndWorld(0.15);
        world.entities[0]!.energy = 1;
        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, THREE.Mesh>;
        expect(indicators.size).toBeGreaterThan(0);

        pool.reset();
        expect(indicators.size).toBe(0);
    });
});
