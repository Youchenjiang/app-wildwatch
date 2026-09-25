import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Entity } from "../sim/entity";
import type { Carrion, Plant, World } from "../sim/world";
import type { ReplayFrame } from "../observe/replay";
import type { EraConfig } from "../sim/era";

const HERB_COLOR = 0xd7f05a;
const CARN_COLOR = 0xc84f4f;

/** Gait wave speed in radians per second. */
export const GAIT_RATE = 11;
/** Frame-to-frame travel, in world units, at which an animal reads as moving.
 * Deliberately small: any real travel drives a full stride, so the amplitude
 * never changes with the tick speed the player picked, while a paused or
 * standing animal (zero travel) settles back into a still pose. */
export const GAIT_REFERENCE_TRAVEL = 0.4;
/** Peak deform as a fraction of the body's size. Kept modest: this is flavour,
 * not a cartoon — the animal must stay readable at god-camera distance. The
 * animals are only a handful of pixels across, so it still has to be big
 * enough to register as life rather than as noise. */
export const GAIT_SQUASH = 0.22;
/** Peak hop height as a fraction of the body's resting height, so a larger
 * (better fed) animal hops proportionally higher. */
export const GAIT_HOP = 0.45;
/** How fast the travel signal eases off once an animal stops. */
const GAIT_DECAY = 0.86;

/**
 * Squash-stretch pose for one animal.
 *
 * `wave` is a sine in [-1, 1]. At +1 the body is at the top of its stride:
 * airborne, stretched tall and thin. At -1 it is grounded and squashed short
 * and wide, like the compression of a landing. The x/z axes are compensated
 * by exactly 1/sqrt against the y deform, so the body really is squashed
 * rather than resized (volume is preserved to floating-point), and the hop is
 * biased upward (0.5 + 0.5 * wave) so a footfall never pushes the body below
 * its resting height.
 */
export function gaitPose(baseScale: number, gait: number, wave: number) {
    const deform = GAIT_SQUASH * gait * wave; // positive = tall, negative = squat
    const counter = 1 / Math.sqrt(1 + deform) - 1;
    return {
        sx: baseScale * (1 + counter),
        sy: baseScale * (1 + deform),
        sz: baseScale * (1 + counter),
        lift: baseScale * GAIT_HOP * gait * (0.5 + 0.5 * wave),
    };
}

/**
 * Advance the smoothed 0..1 "this animal is travelling" signal. It rises to
 * the travel target immediately and eases back down, so a running animal
 * strides at once while a stopped (or paused) one settles into a still pose.
 */
export function nextGait(prev: number, travel: number): number {
    const target = Math.min(1, travel / GAIT_REFERENCE_TRAVEL);
    return target > prev ? target : prev * GAIT_DECAY;
}

/** What the renderer should draw this frame: the live world or a replay frame. */
export interface RenderSubjects {
    entities: Entity[];
    plants: Plant[];
    carrions: Carrion[];
}

/** Keeps a Three.js mesh per sim entity/plant/carrion id, reusing meshes across frames. */
export class MeshPool {
    /** Update plant colors for a new era. Called when the player switches
     * era mid-run or restarts with a different era. */
    setEra(era?: EraConfig): void {
        this.plantPeakColor = new THREE.Color(era?.plantPeakColor ?? 0x3fae5a);
        this.plantTroughColor = new THREE.Color(era?.plantTroughColor ?? 0x9a7b4d);
        this.syncSeason(null);
    }
    private readonly scene: THREE.Scene;
    private readonly npcMeshes = new Map<number, THREE.Mesh>();
    private readonly npcShadows = new Map<number, THREE.Mesh>();
    private readonly plantMeshes = new Map<number, THREE.Mesh>();
    private readonly carrionMeshes = new Map<number, THREE.Mesh>();
    private readonly shadowMat: THREE.MeshBasicMaterial;
    private plantPeakColor = new THREE.Color(0x3fae5a);
    private plantTroughColor = new THREE.Color(0x9a7b4d);
    /** Sphere body + small nose cone so heading stays readable from above. */
    private readonly npcGeometry = MeshPool.buildAnimalGeometry();
    private static buildAnimalGeometry(): THREE.BufferGeometry {
        const body = new THREE.SphereGeometry(0.7, 10, 8);
        // Nose points along +Z so mesh.rotation.y = angle faces the travel direction.
        const nose = new THREE.ConeGeometry(0.22, 0.7, 6);
        nose.rotateX(Math.PI / 2); // cone's +Y axis -> +Z
        nose.translate(0, 0, 0.95);
        // Give the nose a slightly darker vertex tint so the face reads from above.
        const noseColor = new THREE.Color().setRGB(0.62, 0.56, 0.52);
        const noseColors = new Float32Array(nose.attributes.position.count * 3);
        for (let i = 0; i < noseColors.length; i += 3) {
            noseColors[i] = noseColor.r;
            noseColors[i + 1] = noseColor.g;
            noseColors[i + 2] = noseColor.b;
        }
        nose.setAttribute('color', new THREE.BufferAttribute(noseColors, 3));
        body.setAttribute('color', new THREE.BufferAttribute(
            new Float32Array(body.attributes.position.count * 3).fill(1), 3,
        ));
        return mergeGeometries([body, nose], true)!;
    }
    private readonly plantGeometry = new THREE.CylinderGeometry(0.35, 0.5, 0.8, 6);
    private readonly carrionGeometry = new THREE.SphereGeometry(0.65, 8, 6);
    private readonly plantMaterial = new THREE.MeshLambertMaterial({ color: 0x3fae5a });
    private readonly carrionMaterial = new THREE.MeshLambertMaterial({ color: 0x8a7a5c });
    private plantSeasonScale = 1;
    /** Seconds of wall clock driving the gait wave; refreshed by each sync. */
    private animTime = 0;
    /** Last drawn position per animal, used to measure travel between frames. */
    private readonly lastPos = new Map<number, { x: number; y: number }>();
    /** Smoothed travel signal per animal that gates the gait animation. */
    private readonly gait = new Map<number, number>();
    private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
    /** Flat list of animal meshes with ids, rebuilt each sync, for click picking. */
    private pickList: Array<{ id: number; mesh: THREE.Mesh }> = [];
    private readonly ring: THREE.Mesh;
    private selectedId: number | null = null;

    constructor(scene: THREE.Scene, era?: EraConfig) {
        this.scene = scene;
        this.plantPeakColor = new THREE.Color(era?.plantPeakColor ?? 0x3fae5a);
        this.plantTroughColor = new THREE.Color(era?.plantTroughColor ?? 0x9a7b4d);
        this.plantMaterial.color.copy(this.plantPeakColor);
        const ringGeo = new THREE.RingGeometry(1.1, 1.45, 24);
        this.ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        );
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.visible = false;
        scene.add(this.ring);

        this.shadowMat = new THREE.MeshBasicMaterial({
            color: 0x1a1a1a,
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
        });
    }

    private materialFor(color: number, vertexColors = false): THREE.MeshLambertMaterial {
        const key = vertexColors ? color | 0x10000000 : color;
        let material = this.materials.get(key);
        if (!material) {
            material = new THREE.MeshLambertMaterial({ color, vertexColors });
            this.materials.set(key, material);
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
        this.lastPos.clear();
        this.gait.clear();
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

    /** Draw the live world. `animTime` is wall-clock seconds; omitting it
     * holds the gait clock still (a frozen pose). */
    sync(
        world: World,
        selectedId: number | null = null,
        animTime = this.animTime,
    ): void {
        this.animTime = animTime;
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
    syncFrame(
        frame: ReplayFrame,
        selectedId: number | null = null,
        animTime = this.animTime,
    ): void {
        this.animTime = animTime;
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
                mesh = new THREE.Mesh(this.npcGeometry, this.materialFor(e.species.color, true));
                this.scene.add(mesh);
                this.npcMeshes.set(e.id, mesh);
            }
            const scale = 0.6 + 0.8 * Math.min(1, e.energy / e.species.maxEnergy);
            const lift = this.poseAnimal(mesh, e.id, e.pos.x, e.pos.y, e.angle, scale);
            this.pickList.push({ id: e.id, mesh });

            let shadow = this.npcShadows.get(e.id);
            if (!shadow) {
                const shadowGeo = new THREE.CircleGeometry(1, 12);
                shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
                shadow.rotation.x = -Math.PI / 2;
                this.scene.add(shadow);
                this.npcShadows.set(e.id, shadow);
            }
            // The shadow tightens and fades as the body hops clear of it.
            const airborne = lift;
            shadow.scale.setScalar(scale * 0.9 * (1 - 0.3 * airborne));
            shadow.position.set(e.pos.x, 0.02, e.pos.y);
            (shadow.material as THREE.MeshBasicMaterial).opacity =
                (0.22 + 0.14 * Math.min(1, e.energy / e.species.maxEnergy)) * (1 - 0.3 * airborne);
        }
        this.reap(this.npcMeshes, seenNpc);
        this.reap(this.npcShadows, seenNpc);
        this.pruneGait(seenNpc);
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
                mesh = new THREE.Mesh(this.npcGeometry, this.materialFor(color, true));
                this.scene.add(mesh);
                this.npcMeshes.set(n.id, mesh);
            }
            const scale = 0.6 + 0.8 * n.energy01;
            const lift = this.poseAnimal(mesh, n.id, n.x, n.y, n.angle, scale);
            this.pickList.push({ id: n.id, mesh });

            let shadow = this.npcShadows.get(n.id);
            if (!shadow) {
                const shadowGeo = new THREE.CircleGeometry(1, 12);
                shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
                shadow.rotation.x = -Math.PI / 2;
                this.scene.add(shadow);
                this.npcShadows.set(n.id, shadow);
            }
            const airborne = lift;
            shadow.scale.setScalar(scale * 0.9 * (1 - 0.3 * airborne));
            shadow.position.set(n.x, 0.02, n.y);
            (shadow.material as THREE.MeshBasicMaterial).opacity =
                (0.22 + 0.14 * n.energy01) * (1 - 0.3 * airborne);
        }
        this.reap(this.npcMeshes, seenNpc);
        this.reap(this.npcShadows, seenNpc);
        this.pruneGait(seenNpc);
        this.updateRing();
    }

    private pruneGait(seen: Set<number>): void {
        for (const id of this.lastPos.keys()) {
            if (!seen.has(id)) {
                this.lastPos.delete(id);
                this.gait.delete(id);
            }
        }
    }

    /**
     * Pose one animal for this frame: measure how far it travelled since the
     * last sync, then apply a squash-stretch stride with a small hop. Bodies
     * bob out of phase (seeded by id) so a herd never marches in lockstep, and
     * a standing or paused animal (no travel) settles into a clean pose.
     * Returns the normalized airborne height (0..1) so the caller can shrink
     * the shadow as the body rises.
     */
    private poseAnimal(
        mesh: THREE.Mesh,
        id: number,
        x: number,
        y: number,
        angle: number,
        baseScale: number,
    ): number {
        const last = this.lastPos.get(id);
        this.lastPos.set(id, { x, y });
        const travel = last ? Math.hypot(x - last.x, y - last.y) : 0;
        const gait = nextGait(this.gait.get(id) ?? 0, travel);
        this.gait.set(id, gait);
        const wave = Math.sin(this.animTime * GAIT_RATE + id * 1.7);
        const pose = gaitPose(baseScale, gait, wave);
        mesh.scale.set(pose.sx, pose.sy, pose.sz);
        // The sphere rests on its radius, so the standing height tracks the
        // current y squash before the hop is added on top.
        mesh.position.set(x, pose.sy * 0.6 + pose.lift, y);
        mesh.rotation.y = angle;
        // Normalized 0..1 lift, so callers don't have to know the body size.
        return pose.lift / (baseScale * GAIT_HOP);
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
