import * as THREE from "three";

export interface RenderContext {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    view: number;
    /** Seasonal mood lighting/colors for the whole biome. */
    atmosphere: Atmosphere;
}

/**
 * Seasonal atmosphere: sky/fog, light color temperature and the ground all
 * shift with the plant season. Peak is the warm lush summer look; the trough
 * turns the world gray, cold and bleak (plants starve, light dims). `null`
 * means seasons are off — the neutral peak look.
 */
export class Atmosphere {
    private readonly scene: THREE.Scene;
    private readonly hemi: THREE.HemisphereLight;
    private readonly sun: THREE.DirectionalLight;
    private readonly groundMat: THREE.MeshLambertMaterial;
    private readonly gridMat: THREE.LineBasicMaterial;
    private readonly wallMat: THREE.MeshLambertMaterial;

    // Peak (abundance 1): the existing warm, lush summer palette.
    private readonly bgPeak = new THREE.Color(0x0c140e);
    private readonly bgTrough = new THREE.Color(0x303840);
    private readonly hemiSkyPeak = new THREE.Color(0xcfe8d4);
    private readonly hemiSkyTrough = new THREE.Color(0xb0b8c0);
    private readonly hemiGroundPeak = new THREE.Color(0x1c2a20);
    private readonly hemiGroundTrough = new THREE.Color(0x6a6860);
    private readonly sunPeak = new THREE.Color(0xfff3d6);
    private readonly sunTrough = new THREE.Color(0xd8dce4);
    private readonly groundPeak = new THREE.Color(0x2e4631);
    private readonly groundTrough = new THREE.Color(0x8a8878);
    private readonly wallPeak = new THREE.Color(0x4a6a52);
    private readonly wallTrough = new THREE.Color(0x808080);

    constructor(scene: THREE.Scene, worldWidth: number, worldHeight: number) {
        this.scene = scene;
        // Void beyond the world plate + soft ground shading.
        scene.background = new THREE.Color(0x0c140e);
        scene.fog = new THREE.Fog(0x0c140e, 150, 320);

        this.hemi = new THREE.HemisphereLight(0xcfe8d4, 0x1c2a20, 0.9);
        scene.add(this.hemi);

        this.sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
        this.sun.position.set(-50, 130, 30);
        scene.add(this.sun);

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(worldWidth, worldHeight),
            (this.groundMat = new THREE.MeshLambertMaterial({ color: 0x2e4631 })),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(worldWidth / 2, 0, worldHeight / 2);
        scene.add(ground);

        const grid = new THREE.GridHelper(Math.max(worldWidth, worldHeight), 24, 0x3f5a42, 0x364a38);
        grid.position.set(worldWidth / 2, 0.02, worldHeight / 2);
        scene.add(grid);
        // GridHelper's colors live in vertex colors; only its opacity can be
        // animated, so the trough fades the grid into the murk.
        this.gridMat = grid.material as THREE.LineBasicMaterial;
        this.gridMat.transparent = true;

        // Boundary wall marks the closed world (rule 7) so the playfield edge reads clearly.
        const wallHeight = 3;
        this.wallMat = new THREE.MeshLambertMaterial({
            color: 0x4a6a52,
            transparent: true,
            opacity: 0.35,
        });
        const edges: Array<[number, number, number, number]> = [
            [0, 0, worldWidth, 0.4],
            [0, worldHeight, worldWidth, 0.4],
            [0, 0, 0.4, worldHeight],
            [worldWidth, 0, 0.4, worldHeight],
        ];
        for (const [x, z, w, d] of edges) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), this.wallMat);
            wall.position.set(x + w / 2, wallHeight / 2, z + d / 2);
            scene.add(wall);
        }
    }

    /** Shift the whole biome mood with the season; null restores the peak look. */
    syncSeason(abundance: number | null): void {
        const a = abundance === null ? 1 : clamp01(abundance);
        const trough = 1 - a;
        (this.scene.background as THREE.Color).set(this.bgPeak).lerp(this.bgTrough, trough);
        (this.scene.fog as THREE.Fog).color.set(this.bgPeak).lerp(this.bgTrough, trough);
        this.hemi.color.set(this.hemiSkyPeak).lerp(this.hemiSkyTrough, trough);
        this.hemi.groundColor.set(this.hemiGroundPeak).lerp(this.hemiGroundTrough, trough);
        this.hemi.intensity = 0.9 - 0.08 * trough;
        this.sun.color.set(this.sunPeak).lerp(this.sunTrough, trough);
        this.sun.intensity = 1.6 - 0.15 * trough;
        this.groundMat.color.set(this.groundPeak).lerp(this.groundTrough, trough);
        this.gridMat.opacity = 1 - 0.15 * trough;
        this.wallMat.color.set(this.wallPeak).lerp(this.wallTrough, trough);
    }
}

/**
 * God-view (top-down) scene. World (x, y) maps to scene (x, z); +Y is up.
 * The simulation itself never touches Three.js — this is a pure visual layer.
 */
export function createRenderContext(
    container: HTMLElement,
    worldWidth: number,
    worldHeight: number,
): RenderContext {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const view = Math.max(worldWidth, worldHeight) * 0.72;
    const camera = new THREE.OrthographicCamera(-view, view, view, -view, 0.1, 500);
    // Angled god view: offset from straight overhead so 3D shapes stay visible.
    camera.position.set(worldWidth / 2 - 42, 118, worldHeight / 2 + 42);
    camera.lookAt(worldWidth / 2, 0, worldHeight / 2);
    // Remember the default oblique offset so the observer camera can scale it.
    (camera.userData as { baseOffset?: THREE.Vector3 }).baseOffset = camera.position
        .clone()
        .sub(new THREE.Vector3(worldWidth / 2, 0, worldHeight / 2));

    const atmosphere = new Atmosphere(scene, worldWidth, worldHeight);

    return { renderer, scene, camera, view, atmosphere };
}

export function resizeContext(ctx: RenderContext, width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const aspect = w / h;
    ctx.camera.left = -ctx.view * aspect;
    ctx.camera.right = ctx.view * aspect;
    ctx.camera.top = ctx.view;
    ctx.camera.bottom = -ctx.view;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h);
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}