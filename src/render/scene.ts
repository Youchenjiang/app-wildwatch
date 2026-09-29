import * as THREE from "three";
import type { EraConfig } from "../sim/era";

export interface RenderContext {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    /** Half-height of the view a fresh context starts with, in world units.
     * Creation-only: a resize keeps whatever framing the camera has, so this
     * must not be used to re-derive the rect afterwards (that threw the
     * observer's zoom away). */
    view: number;
    /** Seasonal mood lighting/colors for the whole biome. */
    atmosphere: Atmosphere;
}

/** Era-aware atmosphere colors (sky/ground/wall/light) resolved from an era
 * preset; the seasonal sync then lerps between peak and trough.
 */
export interface AtmosphereColors {
    bgPeak: THREE.Color;
    bgTrough: THREE.Color;
    hemiSkyPeak: THREE.Color;
    hemiSkyTrough: THREE.Color;
    hemiGroundPeak: THREE.Color;
    hemiGroundTrough: THREE.Color;
    sunPeak: THREE.Color;
    sunTrough: THREE.Color;
    groundPeak: THREE.Color;
    groundTrough: THREE.Color;
    wallPeak: THREE.Color;
    wallTrough: THREE.Color;
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
    private colors: AtmosphereColors;

    /** Update the atmosphere palette to a new era's colors. Mid-run era
     * transitions call this to retint the sky/ground/light/wall without
     * rebuilding the scene. */
    setColors(colors: AtmosphereColors): void {
        this.colors = colors;
        this.syncSeason(null);
    }

    constructor(
        scene: THREE.Scene,
        worldWidth: number,
        worldHeight: number,
        colors: AtmosphereColors,
    ) {
        this.scene = scene;
        this.colors = colors;
        // Void beyond the world plate + soft ground shading.
        scene.background = colors.bgPeak.clone();
        scene.fog = new THREE.Fog(colors.bgPeak.clone(), 150, 320);

        this.hemi = new THREE.HemisphereLight(
            colors.hemiSkyPeak.clone(),
            colors.hemiGroundPeak.clone(),
            0.9,
        );
        scene.add(this.hemi);

        this.sun = new THREE.DirectionalLight(colors.sunPeak.clone(), 1.6);
        this.sun.position.set(-50, 130, 30);
        scene.add(this.sun);

        this.groundMat = new THREE.MeshLambertMaterial({ color: colors.groundPeak.clone() });
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(worldWidth, worldHeight),
            this.groundMat,
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
            color: colors.wallPeak.clone(),
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
        const seasonalAbundance = abundance === null ? 1 : clamp01(abundance);
        const trough = 1 - seasonalAbundance;
        const colors = this.colors;
        (this.scene.background as THREE.Color).copy(colors.bgPeak).lerp(colors.bgTrough, trough);
        (this.scene.fog as THREE.Fog).color.copy(colors.bgPeak).lerp(colors.bgTrough, trough);
        this.hemi.color.copy(colors.hemiSkyPeak).lerp(colors.hemiSkyTrough, trough);
        this.hemi.groundColor.copy(colors.hemiGroundPeak).lerp(colors.hemiGroundTrough, trough);
        this.hemi.intensity = 0.9 - 0.08 * trough;
        this.sun.color.copy(colors.sunPeak).lerp(colors.sunTrough, trough);
        this.sun.intensity = 1.6 - 0.15 * trough;
        this.groundMat.color.copy(colors.groundPeak).lerp(colors.groundTrough, trough);
        this.gridMat.opacity = 1 - 0.15 * trough;
        this.wallMat.color.copy(colors.wallPeak).lerp(colors.wallTrough, trough);
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
    colors?: AtmosphereColors,
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

    const atmosphere = new Atmosphere(
        scene,
        worldWidth,
        worldHeight,
        colors ?? defaultAtmosphereColors(),
    );

    return { renderer, scene, camera, view, atmosphere };
}

export function defaultAtmosphereColors(): AtmosphereColors {
    return {
        bgPeak: new THREE.Color(0x0c140e),
        bgTrough: new THREE.Color(0x303840),
        hemiSkyPeak: new THREE.Color(0xcfe8d4),
        hemiSkyTrough: new THREE.Color(0xb0b8c0),
        hemiGroundPeak: new THREE.Color(0x1c2a20),
        hemiGroundTrough: new THREE.Color(0x6a6860),
        sunPeak: new THREE.Color(0xfff3d6),
        sunTrough: new THREE.Color(0xd8dce4),
        groundPeak: new THREE.Color(0x2e4631),
        groundTrough: new THREE.Color(0x8a8878),
        wallPeak: new THREE.Color(0x4a6a52),
        wallTrough: new THREE.Color(0x808080),
    };
}

/**
 * Resolve an era's palette into atmosphere colors.
 *
 * The biome's ambient colors (sky background/fog, ground, wall) come straight
 * from the era. The *light* colors must not: an era's sky is a dark void color
 * (grassland is near-black), so using it as the sun would render the whole
 * world at ~10% brightness. Instead we tint a bright base toward the era's sky
 * hue, which keeps each era's color temperature (warm desert, cold ice age)
 * while guaranteeing the scene stays lit.
 */
export function atmosphereColorsForEra(era: EraConfig): AtmosphereColors {
    const sky = new THREE.Color(era.skyColor);
    const skyTrough = new THREE.Color(era.skyTroughColor);
    const tint = (c: THREE.Color, towardWhite: number) =>
        c.clone().lerp(new THREE.Color(0xffffff), towardWhite);
    return {
        bgPeak: new THREE.Color(era.skyColor),
        bgTrough: new THREE.Color(era.skyTroughColor),
        hemiSkyPeak: tint(sky, 0.72),
        hemiSkyTrough: tint(skyTrough, 0.72),
        hemiGroundPeak: new THREE.Color(era.groundColor),
        hemiGroundTrough: new THREE.Color(era.groundTroughColor),
        sunPeak: tint(sky, 0.85),
        sunTrough: tint(skyTrough, 0.85),
        groundPeak: new THREE.Color(era.groundColor),
        groundTrough: new THREE.Color(era.groundTroughColor),
        wallPeak: new THREE.Color(era.groundColor),
        wallTrough: new THREE.Color(era.groundTroughColor),
    };
}

/**
 * Fit the context to a new viewport.
 *
 * A resize changes the viewport, not the framing: the camera's current vertical
 * extent is kept and only the horizontal one follows the new aspect ratio. This
 * used to re-derive the whole rect from the default view, which silently threw
 * away the observer's zoom — any window resize (or a dev tools or side panel
 * opening, which resizes the page) snapped a zoomed-in view back to the whole
 * world. The default view now belongs to creation alone; from then on the
 * camera's framing is whoever drives the camera.
 */
export function resizeContext(ctx: RenderContext, width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const aspect = w / h;
    const halfHeight = (ctx.camera.top - ctx.camera.bottom) / 2;
    ctx.camera.left = -halfHeight * aspect;
    ctx.camera.right = halfHeight * aspect;
    ctx.camera.top = halfHeight;
    ctx.camera.bottom = -halfHeight;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(w, h);
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}