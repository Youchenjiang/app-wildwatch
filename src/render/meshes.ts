import * as THREE from "three";
import type { Entity } from "../sim/entity";
import type { Plant, Carrion } from "../sim/world";

/** Keeps a Three.js mesh per sim entity/plant/carrion id, reusing meshes across frames. */
export class MeshPool {
    private readonly npcMeshes = new Map<number, THREE.Mesh>();
    private readonly plantMeshes = new Map<number, THREE.Mesh>();
    private readonly carrionMeshes = new Map<number, THREE.Mesh>();
    private readonly npcGeometry = new THREE.ConeGeometry(0.6, 1.4, 7);
    private readonly plantGeometry = new THREE.CylinderGeometry(0.18, 0.28, 0.5, 5);
    private readonly carrionGeometry = new THREE.SphereGeometry(0.45, 6, 5);
    private readonly plantMaterial = new THREE.MeshLambertMaterial({ color: 0x3fae5a });
    private readonly carrionMaterial = new THREE.MeshLambertMaterial({ color: 0x8a7a5c });
    private readonly materials = new Map<number, THREE.MeshLambertMaterial>();

    constructor(private readonly scene: THREE.Scene) {}

    private materialFor(color: number): THREE.MeshLambertMaterial {
        let material = this.materials.get(color);
        if (!material) {
            material = new THREE.MeshLambertMaterial({ color });
            this.materials.set(color, material);
        }
        return material;
    }

    /** Drop every mesh (used when a new World replaces the old one). */
    reset(): void {
        for (const mesh of this.npcMeshes.values()) this.scene.remove(mesh);
        for (const mesh of this.plantMeshes.values()) this.scene.remove(mesh);
        for (const mesh of this.carrionMeshes.values()) this.scene.remove(mesh);
        this.npcMeshes.clear();
        this.plantMeshes.clear();
        this.carrionMeshes.clear();
    }

    private reap(pool: Map<number, THREE.Mesh>, seen: Set<number>): void {
        for (const [id, mesh] of pool) {
            if (seen.has(id)) continue;
            this.scene.remove(mesh);
            pool.delete(id);
        }
    }

    sync(entities: Entity[], plants: Plant[], carrions: Carrion[] = []): void {
        const seenNpc = new Set<number>();
        for (const e of entities) {
            if (!e.alive) continue;
            seenNpc.add(e.id);
            let mesh = this.npcMeshes.get(e.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.npcGeometry, this.materialFor(e.species.color));
                this.scene.add(mesh);
                this.npcMeshes.set(e.id, mesh);
            }
            const scale = 0.6 + 0.8 * Math.min(1, e.energy / e.species.maxEnergy);
            mesh.scale.setScalar(scale);
            mesh.position.set(e.pos.x, scale * 0.6, e.pos.y);
            mesh.rotation.y = e.angle;
        }
        this.reap(this.npcMeshes, seenNpc);

        const seenPlant = new Set<number>();
        for (const p of plants) {
            if (!p.alive) continue;
            seenPlant.add(p.id);
            let mesh = this.plantMeshes.get(p.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.plantGeometry, this.plantMaterial);
                this.scene.add(mesh);
                this.plantMeshes.set(p.id, mesh);
            }
            mesh.position.set(p.x, 0.35, p.y);
        }
        this.reap(this.plantMeshes, seenPlant);

        const seenCarrion = new Set<number>();
        for (const c of carrions) {
            if (!c.alive) continue;
            seenCarrion.add(c.id);
            let mesh = this.carrionMeshes.get(c.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.carrionGeometry, this.carrionMaterial);
                this.scene.add(mesh);
                this.carrionMeshes.set(c.id, mesh);
            }
            // Sink into the ground as it decays.
            const scale = 0.5 + 0.5 * Math.min(1, c.energy / 60);
            mesh.scale.setScalar(scale);
            mesh.position.set(c.x, scale * 0.25, c.y);
        }
        this.reap(this.carrionMeshes, seenCarrion);
    }
}
