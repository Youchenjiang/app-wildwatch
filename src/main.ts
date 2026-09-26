import "./style.css";
import { World } from "./sim/world";
import { makeSeeding } from "./sim/seeding";
import { createRenderContext, resizeContext, type RenderContext } from "./render/scene";
import { MeshPool } from "./render/meshes";
import { ObserverCamera } from "./render/camera";
import { createHud } from "./ui/hud";
import { createControls } from "./ui/controls";
import { createInspector } from "./ui/inspector";
import { ReplayRecorder } from "./observe/replay";

const container = document.getElementById("app")!;

let world = new World(makeSeeding());
let ctx: RenderContext = createRenderContext(container, world.config.width, world.config.height);
const pool = new MeshPool(ctx.scene);
const observerCam = new ObserverCamera(ctx.camera, ctx.renderer.domElement, world.config.width, world.config.height);
const hud = createHud(container);
const controls = createControls(container, {
    onPauseToggle: () => {
        paused = !paused;
    },
    onSpeedChange: (dir) => {
        ticksPerFrame = Math.min(60, Math.max(1, ticksPerFrame + dir * 5));
        controls.setSpeed(ticksPerFrame);
    },
    onReplayScrub: (frameIndex) => {
        replayIndex = frameIndex;
    },
    onReplayExit: () => {
        replayIndex = null;
    },
    onCameraReset: () => {
        observerCam.resetView();
        inspector.hide();
    },
    onEndRun: () => {
        world.terminate();
    },
});
const inspector = createInspector(container);
const recorder = new ReplayRecorder(1, 3600);

let ticksPerFrame = 10;
let paused = false;
let replayIndex: number | null = null;

window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
        paused = !paused;
        event.preventDefault();
    } else if (event.key === "+" || event.key === "=") {
        ticksPerFrame = Math.min(60, ticksPerFrame + 5);
        controls.setSpeed(ticksPerFrame);
    } else if (event.key === "-" || event.key === "_") {
        ticksPerFrame = Math.max(1, ticksPerFrame - 5);
        controls.setSpeed(ticksPerFrame);
    } else if (event.key === "r" || event.key === "R") {
        restart();
    } else if (event.key === "Escape") {
        inspector.hide();
        pool.select(null);
        observerCam.follow(null);
    }
});

// Click to select an entity (drag pans, so only treat as a click when the
// pointer barely moved between down and up).
let downX = 0;
let downY = 0;
ctx.renderer.domElement.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
});
ctx.renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return; // it was a drag
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const id = pool.pick(ndcX, ndcY, ctx.camera);
    if (id !== null) {
        pool.select(id);
        inspector.show(id);
        observerCam.follow(id);
    } else {
        pool.select(null);
        inspector.hide();
        observerCam.follow(null);
    }
});

function restart(): void {
    world = new World(makeSeeding());
    recorder.reset();
    pool.reset();
    replayIndex = null;
    inspector.hide();
    observerCam.resetView();
    observerCam.updateFromSim(null, null);
    (window as unknown as { world?: World }).world = world;
}

function stepSimulation(): void {
    if (paused || world.gameOver !== null) return;
    for (let i = 0; i < ticksPerFrame; i++) {
        if (world.gameOver !== null) break;
        world.tickStep();
        if (recorder.shouldCapture(world.tick)) recorder.capture(world);
    }
}

function renderReplay(targetIndex: number): void {
    const frames = recorder.size;
    if (frames > 0) {
        const idx = Math.min(Math.max(0, targetIndex), frames - 1);
        const f = recorder.frameAt(idx);
        if (f) {
            pool.syncFrame(f, inspector.selectedId());
            controls.setReplayIndex(idx, frames);
        }
    }
    inspector.update(null);
}

function renderLive(): void {
    const selectedId = inspector.selectedId();
    pool.sync(world, selectedId);
    if (selectedId !== null) {
        const e = world.entities.find((x) => x.id === selectedId && x.alive);
        observerCam.updateFromSim(e ? e.pos.x : null, e ? e.pos.y : null);
    }
    inspector.update(world);
}

function frame(): void {
    stepSimulation();
    if (replayIndex !== null) {
        renderReplay(replayIndex);
    } else {
        renderLive();
    }

    observerCam.apply();
    ctx.renderer.render(ctx.scene, ctx.camera);
    hud.update(world, paused);
    controls.setPaused(paused);
    controls.setReplayVisible(recorder.size > 0, recorder.size);
    requestAnimationFrame(frame);
}

function onResize(): void {
    resizeContext(ctx, container.clientWidth, container.clientHeight);
}
window.addEventListener("resize", onResize);
onResize();

frame();

// Debug handles so the sim and observer tools can be poked from the console.
function selectEntity(id: number | null): void {
    pool.select(id);
    if (id !== null) {
        inspector.show(id);
        observerCam.follow(id);
    } else {
        inspector.hide();
        observerCam.follow(null);
    }
}
(window as unknown as { world?: World }).world = world;
(window as unknown as { __obs?: unknown }).__obs = {
    select: selectEntity,
    replay: (i: number | null) => {
        replayIndex = i;
    },
    zoom: (f: number) => observerCam.setZoom(f),
    resetView: () => observerCam.resetView(),
    recorder: () => recorder.stats(),
    restart,
};
