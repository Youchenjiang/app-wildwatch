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

    const view = Math.max(worldWidth, worldHeight) * 0.62;
    const camera = new THREE.OrthographicCamera(-view, view, view, -view, 0.1, 500);
    camera.position.set(worldWidth / 2, 140, worldHeight / 2);
    camera.lookAt(worldWidth / 2, 0, worldHeight / 2);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a5a3f, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(60, 120, 40);
    scene.add(sun);

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