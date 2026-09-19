import * as THREE from "three";

export interface RenderContext {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    view: number;
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
    scene.background = new THREE.Color(0x1c2a22);

    const view = Math.max(worldWidth, worldHeight) * 0.72;
    const camera = new THREE.OrthographicCamera(-view, view, view, -view, 0.1, 500);
    // Angled god view: offset from straight overhead so 3D shapes stay visible.
    camera.position.set(worldWidth / 2 - 42, 118, worldHeight / 2 + 42);
    camera.lookAt(worldWidth / 2, 0, worldHeight / 2);

    scene.fog = new THREE.Fog(0x0c140e, 150, 320);

    scene.add(new THREE.HemisphereLight(0xcfe8d4, 0x1c2a20, 0.9));
    const sun = new THREE.DirectionalLight(0xfff3d6, 1.6);
    sun.position.set(-50, 130, 30);
    scene.add(sun);

    // Void beyond the world plate + soft ground shading.
    scene.background = new THREE.Color(0x0c140e);

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(worldWidth, worldHeight),
        new THREE.MeshLambertMaterial({ color: 0x2e4631 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(worldWidth / 2, 0, worldHeight / 2);
    scene.add(ground);

    const grid = new THREE.GridHelper(Math.max(worldWidth, worldHeight), 24, 0x3f5a42, 0x364a38);
    grid.position.set(worldWidth / 2, 0.02, worldHeight / 2);
    scene.add(grid);

    // Boundary wall marks the closed world (rule 7) so the playfield edge reads clearly.
    const wallHeight = 3;
    const wallMaterial = new THREE.MeshLambertMaterial({
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
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMaterial);
        wall.position.set(x + w / 2, wallHeight / 2, z + d / 2);
        scene.add(wall);
    }

    return { renderer, scene, camera, view };
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