import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Scene } from "three";
import { MeshPool } from "../src/render/meshes";
import { World, type WorldConfig } from "../src/sim/world";
import { makeSeeding } from "../src/sim/seeding";
import type { Entity } from "../src/sim/entity";

function requireEntity(world: World, index: number): Entity {
    const entity = world.entities[index];
    expect(entity).toBeDefined();
    if (!entity) {
        throw new Error(`Expected entity at index ${index}`);
    }
    return entity;
}

function requireIndicator(indicators: Map<number, Mesh>, id: number): Mesh {
    const ring = indicators.get(id);
    expect(ring).toBeDefined();
    if (!ring) {
        throw new Error(`Expected indicator for entity ${id}`);
    }
    return ring;
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
    const pool = new MeshPool(new Scene());
    return { pool, world };
}

describe("cannibalism indicator", () => {
    it("shows a pulsing ring above a starving carnivore", () => {
        const { pool, world } = poolAndWorld(0.15);
        const starver = requireEntity(world, 0);
        starver.energy = 1; // below 0.15 * 100 = 15
        const healthy = requireEntity(world, 1);
        healthy.energy = 80;

        pool.sync(world, null, 1.0);

        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        const ring = requireIndicator(indicators, starver.id);
        expect(ring.visible).toBe(true);
        expect(ring.position.y).toBeGreaterThan(0);

        // Healthy carnivore should have no indicator.
        expect(indicators.has(healthy.id)).toBe(false);
    });

    it("hides the ring once the carnivore recovers above the threshold", () => {
        const { pool, world } = poolAndWorld(0.15);
        const carnivore = requireEntity(world, 0);
        carnivore.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        expect(requireIndicator(indicators, carnivore.id).visible).toBe(true);

        // Recover above threshold.
        carnivore.energy = 80;
        pool.sync(world, null, 2.0);
        expect(requireIndicator(indicators, carnivore.id).visible).toBe(false);
    });

    it("does not create indicators when cannibalism is disabled (threshold = 0)", () => {
        const { pool, world } = poolAndWorld(0);
        const carnivore = requireEntity(world, 0);
        carnivore.energy = 1;

        pool.sync(world, null, 1.0);

        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        expect(indicators.size).toBe(0);
    });

    it("cleans up indicators when an animal dies", () => {
        const { pool, world } = poolAndWorld(0.15);
        const starver = requireEntity(world, 0);
        starver.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        expect(indicators.has(starver.id)).toBe(true);

        // Kill the animal and sync — indicator should be pruned.
        starver.alive = false;
        pool.sync(world, null, 2.0);
        expect(indicators.has(starver.id)).toBe(false);
    });

    it("pulse opacity changes over time", () => {
        const { pool, world } = poolAndWorld(0.15);
        const carnivore = requireEntity(world, 0);
        carnivore.energy = 1;

        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        const ring = requireIndicator(indicators, carnivore.id);
        const material = ring.material as MeshBasicMaterial;
        const op1 = material.opacity;

        pool.sync(world, null, 2.0);
        const op2 = material.opacity;

        expect(op1).not.toBeCloseTo(op2, 2);
    });

    it("cleans up all indicators on reset", () => {
        const { pool, world } = poolAndWorld(0.15);
        const starver = requireEntity(world, 0);
        starver.energy = 1;
        pool.sync(world, null, 1.0);
        const indicators = pool["cannibalIndicators"] as Map<number, Mesh>;
        expect(indicators.size).toBeGreaterThan(0);

        pool.reset();
        expect(indicators.size).toBe(0);
    });
});
