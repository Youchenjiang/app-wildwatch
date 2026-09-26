import * as THREE from "three";
import type { Entity } from "../sim/entity";
import type { Carrion, Plant, World } from "../sim/world";
import type { ReplayFrame } from "../observe/replay";

const HERB_COLOR = 0xd7f05a;
const CARN_COLOR = 0xc84f4f;

/** What the renderer should draw this frame: the live world or a replay frame. */
export interface RenderSubjects {
    entities: Entity[];
    plants: Plant[];
    carrions: Carrion[];
}

/** Keeps a Three.js mesh per sim entity/plant/carrion id, reusing meshes across frames. */
export class MeshPool {
    private readonly scene: THREE.Scene;
    private readonly npcMeshes = new Map<number, THREE.Mesh>();
    private readonly plantMeshes = new Map<number, THREE.Mesh>();
    private readonly carrionMeshes = new Map<number, THREE.Mesh>();
    private readonly npcGeometry = new THREE.ConeGeometry(0.6, 1.4, 7);
    private readonly plantGeometry = new THREE.CylinderGeometry(0.18, 0.28, 0.5, 5);
    private readonly carrionGeometry = new THREE.SphereGeometry(0.45, 6, 5);
    private readonly plantMaterial = new THREE.MeshLambertMaterial({ color: 0x3fae5a });
    private readonly carrionMaterial = new THREE.MeshLambertMaterial({ color: 0x8a7a5c });
    // Seasonal tint: plants lerp from dry brown (trough) to lush green (peak).
    private readonly plantPeakColor = new THREE.Color(0x3fae5a);
    private readonly plantTroughColor = new THREE.Color(0x9a7b4d);
    private plantSeasonScale = 1;
    private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
    /** Flat list of animal meshes with ids, rebuilt each sync, for click picking. */
    private pickList: Array<{ id: number; mesh: THREE.Mesh }> = [];
    private readonly ring: THREE.Mesh;
    private selectedId: number | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        const ringGeo = new THREE.RingGeometry(1.1, 1.45, 24);
        this.ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        );
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.visible = false;
        scene.add(this.ring);
    }

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
        this.pickList = [];
        this.ring.visible = false;
        this.selectedId = null;
    }

    private reap(pool: Map<number, THREE.Mesh>, seen: Set<number>): void {
        for (const [id, mesh] of pool) {
            if (seen.has(id)) continue;
            this.scene.remove(mesh);
            pool.delete(id);
        }
    }

    /** Draw the live world. */
    sync(
        world: World,
        selectedId: number | null = null,
    ): void {
        const seasonal = (world.config.plantSeasonLength ?? 0) > 0;
        this.syncSeason(seasonal ? world.seasonAbundance : null);
        this.syncSubjects({ entities: world.entities, plants: world.plants, carrions: world.carrions }, selectedId);
    }

    /** Draw either the live world's collections or a replay frame's decoding of them. */
    syncSubjects(
        subjects: RenderSubjects,
        selectedId: number | null = null,
    ): void {
        this.selectedId = selectedId;
        this.syncNpcs(subjects.entities);
        this.syncPlants(subjects.plants);
        this.syncCarrions(subjects.carrions);
    }

    /** Draw a recorded replay frame instead of the live world. */
    syncFrame(frame: ReplayFrame, selectedId: number | null = null): void {
        this.selectedId = selectedId;
        // Replays carry their own season position: plants tint and size with
        // the historical tick (null means seasons were off — neutral look).
        this.syncSeason(frame.seasonAbundance);
        const npcLike = frame.entities.map((row) => ({
            id: row[0],
            kind: row[1],
            x: row[2],
            y: row[3],
            angle: row[4],
            energy01: row[5],
        }));
        this.syncNpcsFrame(npcLike);
        this.syncPlantsFrame(frame.plants);
        this.syncCarrionsFrame(frame.carrions);
    }

    // ------------------------------------------------------------------
    // Season & live-object syncs
    // ------------------------------------------------------------------

    /** Shift the whole biome with the season: lush at the peak, dry at the trough. */
    private syncSeason(abundance: number | null): void {
        if (abundance === null) {
            this.plantMaterial.color.copy(this.plantPeakColor);
            this.plantSeasonScale = 1;
            return;
        }
        this.plantMaterial.color.copy(this.plantTroughColor).lerp(this.plantPeakColor, abundance);
        this.plantSeasonScale = 0.7 + 0.6 * abundance;
    }

    private syncNpcs(entities: Entity[]): void {
        const seenNpc = new Set<number>();
        this.pickList = [];
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
            this.pickList.push({ id: e.id, mesh });
        }
        this.reap(this.npcMeshes, seenNpc);
        this.updateRing();
    }

    private syncNpcsFrame(
        npcs: Array<{ id: number; kind: number; x: number; y: number; angle: number; energy01: number }>,
    ): void {
        const seenNpc = new Set<number>();
        this.pickList = [];
        for (const n of npcs) {
            seenNpc.add(n.id);
            let mesh = this.npcMeshes.get(n.id);
            if (!mesh) {
                const color = n.kind === 0 ? HERB_COLOR : CARN_COLOR;
                mesh = new THREE.Mesh(this.npcGeometry, this.materialFor(color));
                this.scene.add(mesh);
                this.npcMeshes.set(n.id, mesh);
            }
            const scale = 0.6 + 0.8 * n.energy01;
            mesh.scale.setScalar(scale);
            mesh.position.set(n.x, scale * 0.6, n.y);
            mesh.rotation.y = n.angle;
            this.pickList.push({ id: n.id, mesh });
        }
        this.reap(this.npcMeshes, seenNpc);
        this.updateRing();
    }

    private syncPlants(plants: Plant[]): void {
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
            mesh.scale.setScalar(this.plantSeasonScale);
            mesh.position.set(p.x, 0.35, p.y);
        }
        this.reap(this.plantMeshes, seenPlant);
    }

    private syncPlantsFrame(rows: number[][]): void {
        const seen = new Set<number>();
        for (const row of rows) {
            const id = row[0];
            seen.add(id);
            let mesh = this.plantMeshes.get(id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.plantGeometry, this.plantMaterial);
                this.scene.add(mesh);
                this.plantMeshes.set(id, mesh);
            }
            mesh.scale.setScalar(this.plantSeasonScale);
            mesh.position.set(row[1], 0.35, row[2]);
        }
        this.reap(this.plantMeshes, seen);
    }

    private syncCarrions(carrions: Carrion[]): void {
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
            const scale = 0.5 + 0.5 * Math.min(1, c.energy / 60);
            mesh.scale.setScalar(scale);
            mesh.position.set(c.x, scale * 0.25, c.y);
        }
        this.reap(this.carrionMeshes, seenCarrion);
    }

    private syncCarrionsFrame(rows: number[][]): void {
        const seen = new Set<number>();
        for (const row of rows) {
            const id = row[0];
            seen.add(id);
            let mesh = this.carrionMeshes.get(id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.carrionGeometry, this.carrionMaterial);
                this.scene.add(mesh);
                this.carrionMeshes.set(id, mesh);
            }
            const scale = 0.5 + 0.5 * Math.min(1, row[3] / 60);
            mesh.scale.setScalar(scale);
            mesh.position.set(row[1], scale * 0.25, row[2]);
        }
        this.reap(this.carrionMeshes, seen);
    }

    // ------------------------------------------------------------------
    // Picking & selection
    // ------------------------------------------------------------------

    /** Find the animal whose mesh is under screen coordinates (ndcX, ndcY). */
    pick(ndcX: number, ndcY: number, camera: THREE.OrthographicCamera): number | null {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const meshes = this.pickList.map((p) => p.mesh);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length === 0) return null;
        const hitMesh = hits[0].object;
        const found = this.pickList.find((p) => p.mesh === hitMesh);
        return found ? found.id : null;
    }

    select(id: number | null): void {
        this.selectedId = id;
        this.updateRing();
    }

    private updateRing(): void {
        if (this.selectedId === null) {
            this.ring.visible = false;
            return;
        }
        const mesh = this.npcMeshes.get(this.selectedId);
        if (!mesh) {
            this.ring.visible = false;
            return;
        }
        this.ring.visible = true;
        this.ring.position.set(mesh.position.x, 0.08, mesh.position.z);
    }
}
