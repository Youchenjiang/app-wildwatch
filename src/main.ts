import "./style.css";
import { DEFAULT_BRAIN_SPEC, World, type WorldConfig } from "./sim/world";
import { createRenderContext, resizeContext } from "./render/scene";
import { MeshPool } from "./render/meshes";
import { createHud } from "./ui/hud";

const container = document.getElementById("app")!;

function makeConfig(): WorldConfig {
    return {
        width: 120,
        height: 120,
        seed: 20260907,
        herbivoreCount: 60,
        carnivoreCount: 16,
        plantCount: 240,
        plantRegrowPerTick: 4,
        plantEnergy: 18,
        maxPlants: 600,
        turnLength: 100,
        populationCap: 500,
        mateRange: 3,
        mutationRate: 0.06,
        mutationSigma: 0.35,
        brainSpec: DEFAULT_BRAIN_SPEC,
    };
}

let world = new World(makeConfig());
const ctx = createRenderContext(container, world.config.width, world.config.height);
const pool = new MeshPool(ctx.scene);
const hud = createHud(container);

let ticksPerFrame = 10;
let paused = false;

window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
        paused = !paused;
        event.preventDefault();
    } else if (event.key === "+" || event.key === "=") {
        ticksPerFrame = Math.min(60, ticksPerFrame + 5);
    } else if (event.key === "-" || event.key === "_") {
        ticksPerFrame = Math.max(1, ticksPerFrame - 5);
    } else if (event.key === "r" || event.key === "R") {
        world = new World(makeConfig());
        pool.reset();
        (window as unknown as { world?: World }).world = world;
    }
});

function frame(): void {
    if (!paused) {
        for (let i = 0; i < ticksPerFrame; i++) world.tickStep();
    }
    pool.sync(world.entities, world.plants);
    ctx.renderer.render(ctx.scene, ctx.camera);
    hud.update(world);
    requestAnimationFrame(frame);
}

function onResize(): void {
    resizeContext(ctx, container.clientWidth, container.clientHeight);
}
window.addEventListener("resize", onResize);
onResize();

frame();

// Debug handle so the sim can be poked from the console.
(window as unknown as { world?: World }).world = world;