import "./style.css";
import { World } from "./sim/world";
import { makeSeeding } from "./sim/seeding";
import {
    atmosphereColorsForEra,
    createRenderContext,
    defaultAtmosphereColors,
    resizeContext,
    type RenderContext,
} from "./render/scene";
import { MeshPool } from "./render/meshes";
import { ObserverCamera } from "./render/camera";
import { createHud } from "./ui/hud";
import { createControls } from "./ui/controls";
import { createInspector } from "./ui/inspector";
import { createWelcome } from "./ui/welcome";
import { ReplayRecorder } from "./observe/replay";
import { DEFAULT_TICKS_PER_SECOND, SPEED_STEPS, advanceTicks } from "./observe/pacing";
import { desertEra, grasslandEra, iceAgeEra } from "./sim/era";
import { createDefaultGodMemory, loadGodMemory, sacredSeedToBrain } from "./sim/persistence";

import type { EraConfig } from "./sim/era";

const appElement = document.getElementById("app");
if (!appElement) {
    throw new Error("Missing #app element");
}
const container = appElement;

/** Atmosphere colors for the active era, or the neutral default with no era. */
function eraAtmosphereColors(era?: EraConfig) {
    return era ? atmosphereColorsForEra(era) : defaultAtmosphereColors();
}

let godMemory = createDefaultGodMemory();
const founderGenomes = {
    herbivore: sacredSeedToBrain(godMemory.sacredSeeds.herbivore),
    carnivore: sacredSeedToBrain(godMemory.sacredSeeds.carnivore),
};
async function syncGodMemory() {
    try {
        godMemory = await loadGodMemory("./data/god-memory.json");
        founderGenomes.herbivore = sacredSeedToBrain(godMemory.sacredSeeds.herbivore);
        founderGenomes.carnivore = sacredSeedToBrain(godMemory.sacredSeeds.carnivore);
    } catch {
        // Fallback default god memory is already in place
    }
}
syncGodMemory().catch(() => {});

let world = new World({ ...makeSeeding(), founderGenomes });
let ctx: RenderContext = createRenderContext(
    container,
    world.config.width,
    world.config.height,
    eraAtmosphereColors(world.config.era),
);
const pool = new MeshPool(ctx.scene, world.config.era);
const observerCam = new ObserverCamera(ctx.camera, ctx.renderer.domElement, world.config.width, world.config.height);
const hud = createHud(container);
const inspector = createInspector(container);
const recorder = new ReplayRecorder(1, 3600);

// The run advances by accumulated wall-clock time, not a fixed number of ticks
// per frame, so a speed slower than one tick per frame is expressible at all.
let speedIndex = Math.max(0, SPEED_STEPS.indexOf(DEFAULT_TICKS_PER_SECOND));
let tickCarry = 0;
let lastFrameMs = performance.now();
let paused = true;
let replayIndex: number | null = null;

// Welcome screen: pick an era and how the populations propagate, then start.
// The picker is reopened by 換設定, so these two outlive the first choice —
// they are what `R 重新投放` re-drops the animals with.
let selectedEra: import("./sim/era").EraConfig | undefined;
let selectedReproduction: import("./sim/world").ReproductionMode = "asexual";
const welcome = createWelcome(
    container,
    (era, reproduction) => {
        selectedEra = era;
        selectedReproduction = reproduction;
        // The module-level world was seeded with no era; re-seed from the chosen
        // one so the picker actually decides the run instead of only the next R.
        restart();
        paused = false;
    },
    [grasslandEra, iceAgeEra, desertEra],
);
welcome.show();

const controls = createControls(container, {
    onPauseToggle: () => {
        paused = !paused;
    },
    onSpeedChange: (step) => {
        speedIndex = Math.min(SPEED_STEPS.length - 1, Math.max(0, speedIndex + step));
        controls.setSpeed(SPEED_STEPS[speedIndex]);
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
    onChangeSetup: () => {
        welcome.show({ era: world.config.era, reproduction: world.config.reproduction });
    },
    onEndRun: () => {
        world.terminate();
    },
});

window.addEventListener("keydown", (event) => {
    // While the picker is up it owns the keyboard, so a Space or R meant for
    // the card in front of the player cannot silently re-seed what is behind.
    if (welcome.isOpen()) return;
    if (event.code === "Space") {
        paused = !paused;
        event.preventDefault();
    } else if (event.key === "+" || event.key === "=") {
        speedIndex = Math.min(SPEED_STEPS.length - 1, speedIndex + 1);
        controls.setSpeed(SPEED_STEPS[speedIndex]);
    } else if (event.key === "-" || event.key === "_") {
        speedIndex = Math.max(0, speedIndex - 1);
        controls.setSpeed(SPEED_STEPS[speedIndex]);
    } else if (event.key === "r" || event.key === "R") {
        restart();
    } else if (event.key === "Escape") {
        inspector.hide();
        pool.select(null);
        observerCam.follow(null);
    }
});

// Click to select a subject — an animal or a tuft (drag pans, so only treat it
// as a click when the pointer barely moved between down and up).
let downX = 0;
let downY = 0;
ctx.renderer.domElement.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
});
ctx.renderer.domElement.addEventListener("pointerup", (event) => {
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return; // it was a drag
    const rect = ctx.renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    selectSubject(pool.pick(ndcX, ndcY, ctx.camera));
});

function restart(): void {
    // Both seeding choices are locked into the run here, never consulted again
    // (rule 2: nothing about a run changes after it is seeded).
    world = new World({
        ...makeSeeding(undefined, selectedEra, selectedReproduction),
        founderGenomes,
    });
    ctx.atmosphere.setColors(eraAtmosphereColors(world.config.era));

    pool.setEra(world.config.era);
    tickCarry = 0;
    recorder.reset();
    pool.reset();
    replayIndex = null;
    inspector.hide();
    observerCam.resetView();
    observerCam.updateFromSim(null, null);
    (window as unknown as { world?: World }).world = world;
}

// Wall-clock origin for the animals' gait animation. Using real elapsed time
// keeps the stride smooth regardless of tick speed or frame rate.
const animStart = performance.now();

function stepSimulation(nowMs: number): void {
    const running = !paused && world.gameOver === null;
    if (running) {
        const advance = advanceTicks(tickCarry, SPEED_STEPS[speedIndex], (nowMs - lastFrameMs) / 1000);
        tickCarry = advance.carry;
        for (let tickIndex = 0; tickIndex < advance.ticks; tickIndex++) {
            if (world.gameOver !== null) break;
            world.tickStep();
            if (recorder.shouldCapture(world.tick)) recorder.capture(world);
        }
    } else {
        // Drop the leftover rather than banking it: a long pause should not
        // come back as a burst of catch-up ticks on the first unpaused frame.
        tickCarry = 0;
    }
    lastFrameMs = nowMs;
}

function renderReplay(targetIndex: number, animTime: number): void {
    const frames = recorder.size;
    if (frames > 0) {
        const frameIndex = Math.min(Math.max(0, targetIndex), frames - 1);
        const recordedFrame = recorder.frameAt(frameIndex);
        if (recordedFrame) {
            pool.syncFrame(recordedFrame, inspector.selectedId(), animTime);
            ctx.atmosphere.syncSeason(recordedFrame.seasonAbundance);
            hud.update(world, paused, recordedFrame);
            controls.setReplayIndex(frameIndex, frames);
        }
    }
    inspector.update(null);
}

function renderLive(animTime: number): void {
    const selectedId = inspector.selectedId();
    pool.sync(world, selectedId, animTime);
    ctx.atmosphere.syncSeason((world.config.plantSeasonLength ?? 0) > 0 ? world.seasonAbundance : null);
    if (selectedId !== null) {
        const selectedEntity = world.entities.find((entity) => entity.id === selectedId && entity.alive);
        observerCam.updateFromSim(selectedEntity ? selectedEntity.pos.x : null, selectedEntity ? selectedEntity.pos.y : null);
    }
    inspector.update(world);
    hud.update(world, paused);
}

function frame(): void {
    const nowMs = performance.now();
    const animTime = (nowMs - animStart) / 1000;
    const replayIndexNow = replayIndex;
    stepSimulation(nowMs);
    if (replayIndexNow !== null) {
        renderReplay(replayIndexNow, animTime);
    } else {
        renderLive(animTime);
    }

    observerCam.apply();
    ctx.renderer.render(ctx.scene, ctx.camera);
    controls.setPaused(paused);
    controls.setReplayVisible(replayIndexNow !== null, recorder.size);
    requestAnimationFrame(frame);
}

function onResize(): void {
    resizeContext(ctx, container.clientWidth, container.clientHeight);
}
window.addEventListener("resize", onResize);
onResize();

frame();

/**
 * Select whatever a click landed on. A tuft is selected exactly like an animal
 * — the pick hands back a sim id, and the inspector works out what it belongs
 * to — but the camera does not follow it: a plant never moves, so a follow would
 * only pin the view without ever having anything to track.
 */
function selectSubject(id: number | null): void {
    pool.select(id);
    if (id === null) {
        inspector.hide();
        observerCam.follow(null);
        return;
    }
    inspector.show(id);
    observerCam.follow(isPlant(id) ? null : id);
}

/** Whether an id belongs to a plant rather than an animal. */
function isPlant(id: number): boolean {
    return world.plants.some((plant) => plant.id === id);
}

// Debug handles so the sim and observer tools can be poked from the console.
function selectEntity(id: number | null): void {
    selectSubject(id);
}
(window as unknown as { world?: World }).world = world;
(window as unknown as { __obs?: unknown }).__obs = {
    select: selectEntity,
    replay: (frameIdx: number | null) => {
        replayIndex = frameIdx;
    },
    zoom: (factor: number) => observerCam.setZoom(factor),
    resetView: () => observerCam.resetView(),
    recorder: () => recorder.stats(),
    restart,
    // What the observer camera is actually doing, and where a sim position is
    // drawn: the only way something outside the page (the browser harness)
    // can check a real gesture's effect and aim one at a specific animal.
    view: () => observerCam.viewState(),
    screenPoint: (x: number, y: number) => observerCam.screenPoint(x, y),
    // Which subject the last click selected: the inspector keeps it, and an
    // outside driver cannot see it any other way.
    selected: () => inspector.selectedId(),
};
