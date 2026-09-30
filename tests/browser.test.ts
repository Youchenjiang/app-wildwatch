/**
 * Browser-level scenarios for the observer controls.
 *
 * These drive a real Chromium running the real app (see
 * `tests/browser-harness.ts`): real wheel gestures, real pointer presses and
 * releases, real key presses, a real viewport resize. The unit tests in
 * `tests/camera.test.ts` cover the camera's arithmetic against a stubbed DOM;
 * what they cannot see is the wiring — whether a gesture reaches the listener
 * that is supposed to own it, whether a pan also selects the animal it
 * crossed, whether a window resize reaches `resizeContext` at all. That is
 * what this file is for.
 *
 * Two things worth knowing about the conditions here, both measured rather
 * than assumed. The run advances hundreds of ticks a second in headless
 * Chromium, and a body is only a few pixels across at the default framing, so
 * anything aiming a click at a specific animal pauses first. And animals are
 * eaten: a scenario must not hang its claim on one staying alive.
 *
 * Cheap fallback: no Chromium-family browser means the scenarios are reported
 * as skipped, not failed. Point `CHROME_PATH` at one to run them; set
 * `BROWSER_HEADED=1` to watch them in a real window. A failing scenario leaves
 * a screenshot in `tmp/browser/`.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import type { ObserverViewState } from "../src/render/camera";
import {
    browserEnv,
    findBrowser,
    startBrowserSession,
    type BrowserSession,
    type Point,
} from "./browser-harness";


/**
 * Page-side probes, injected as a string.
 *
 * Kept as a real function so the syntax is checked and edited like code, then
 * stringified into the page. It must therefore be self-contained — nothing
 * from this module's scope reaches it — and every value it returns has to
 * survive JSON serialization, since the CDP bridge returns by value.
 */
function installProbe(): void {
    interface SimEntity {
        id: number;
        alive: boolean;
        energy: number;
        pos: { x: number; y: number };
        species: { kind: string };
    }
    interface SimPlant {
        id: number;
        x: number;
        y: number;
        bites: number;
        energy: number;
    }
    const globals = globalThis as unknown as {
        __obs: { screenPoint(x: number, y: number): { x: number; y: number } };
        world: { tick: number; entities: SimEntity[]; plants: SimPlant[] };
    };
    const canvasEl = (): HTMLCanvasElement | null => document.querySelector("#app canvas");
    const rect = () => {
        const el = canvasEl();
        if (!el) throw new Error("the app has not created its canvas");
        const bounds = el.getBoundingClientRect();
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            right: bounds.right,
            bottom: bounds.bottom,
        };
    };
    // A gesture has to land on the canvas itself: the observer's listeners are
    // on the canvas, so a point under the HUD, the control bar or the inspector
    // would be driving nothing.
    const overCanvas = (x: number, y: number): boolean => {
        const el = document.elementFromPoint(x, y);
        return el !== null && el.tagName === "CANVAS";
    };

    (globalThis as unknown as { __probe?: unknown }).__probe = {
        canvasRect: rect,
        onCanvas: overCanvas,
        canvasCentre(): Point | null {
            const bounds = rect();
            const cx = bounds.left + bounds.width / 2;
            const cy = bounds.top + bounds.height / 2;
            const offsets: Array<[number, number]> = [
                [0, 0],
                [0, -90],
                [0, 90],
                [-160, 0],
                [160, 0],
                [-160, -90],
                [160, 90],
            ];
            for (const [dx, dy] of offsets) {
                if (overCanvas(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
            }
            return null;
        },
        canvasMiddle(): Point {
            const bounds = rect();
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
        },
        animalOnCanvas(minDistanceFromCentre: number): { id: number; x: number; y: number } | null {
            const bounds = rect();
            const cx = bounds.left + bounds.width / 2;
            const cy = bounds.top + bounds.height / 2;
            let best: { id: number; x: number; y: number; distance: number; rank: number } | null = null;
            for (const entity of globals.world.entities) {
                if (!entity.alive) continue;
                const screenPos = globals.__obs.screenPoint(entity.pos.x, entity.pos.y);
                if (
                    screenPos.x < bounds.left + 12 ||
                    screenPos.y < bounds.top + 12 ||
                    screenPos.x > bounds.right - 12 ||
                    screenPos.y > bounds.bottom - 12
                ) {
                    continue;
                }
                const distance = Math.hypot(screenPos.x - cx, screenPos.y - cy);
                if (distance < minDistanceFromCentre) continue;
                if (!overCanvas(screenPos.x, screenPos.y)) continue;
                // Herbivores first: they are the bulk of the population and
                // far less likely to be eaten while a scenario watches them.
                const rank = entity.species.kind === "herbivore" ? 0 : 1;
                if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
                    best = { id: entity.id, x: screenPos.x, y: screenPos.y, distance, rank };
                }
            }
            return best ? { id: best.id, x: best.x, y: best.y } : null;
        },
        // A tuft to click: plants are picked with a little slop, so a tuft near
        // the middle is the easiest thing in the world to aim at.
        plantOnCanvas(minDistanceFromCentre: number): { id: number; x: number; y: number; bites: number } | null {
            const bounds = rect();
            const centreX = bounds.left + bounds.width / 2;
            const centreY = bounds.top + bounds.height / 2;
            let best: { id: number; x: number; y: number; bites: number; distance: number } | null = null;
            for (const plant of globals.world.plants) {
                const point = globals.__obs.screenPoint(plant.x, plant.y);
                if (point.x < bounds.left + 12 || point.y < bounds.top + 12 || point.x > bounds.right - 12 || point.y > bounds.bottom - 12) {
                    continue;
                }
                if (!overCanvas(point.x, point.y)) continue;
                const distance = Math.hypot(point.x - centreX, point.y - centreY);
                if (distance < minDistanceFromCentre) continue;
                if (!best || distance < best.distance) {
                    best = { id: plant.id, x: point.x, y: point.y, bites: plant.bites, distance };
                }
            }
            return best ? { id: best.id, x: best.x, y: best.y, bites: best.bites } : null;
        },
        plantBites(id: number): number | null {
            const plant = globals.world.plants.find((plantItem) => plantItem.id === id);
            return plant ? plant.bites : null;
        },
        plantScreenPoint(id: number): Point | null {
            const plant = globals.world.plants.find((p) => p.id === id);
            return plant ? globals.__obs.screenPoint(plant.x, plant.y) : null;
        },
        animalScreenPoint(id: number): Point | null {
            const entity = globals.world.entities.find((candidate) => candidate.id === id);
            if (!entity || !entity.alive) return null;
            return globals.__obs.screenPoint(entity.pos.x, entity.pos.y);
        },
        animalPos(id: number): { x: number; y: number } | null {
            const entity = globals.world.entities.find((candidate) => candidate.id === id);
            return entity ? { x: entity.pos.x, y: entity.pos.y } : null;
        },
        // Moves the followed body without letting the simulation decide when it
        // moves, so the camera's tracking can be measured on demand. The spatial
        // index is refiled on the next tick; nothing here depends on that.
        nudgeAnimal(id: number, dx: number, dy: number): { x: number; y: number } | null {
            const entity = globals.world.entities.find((candidate) => candidate.id === id);
            if (!entity || !entity.alive) return null;
            entity.pos.x += dx;
            entity.pos.y += dy;
            return { x: entity.pos.x, y: entity.pos.y };
        },
        waitFrames(count: number): Promise<number> {
            return new Promise<number>((resolve) => {
                let seen = 0;
                const step = (): void => {
                    seen += 1;
                    if (seen >= count) resolve(seen);
                    else requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            });
        },
        inspectorOpen(): boolean {
            const el = document.querySelector<HTMLElement>("#inspector");
            return el !== null && !el.hidden;
        },
        hudState(): string {
            return (document.querySelector("#hud-state")?.textContent ?? "").trim();
        },
        speedLabel(): string {
            return (document.querySelector("#ctl-speed-label")?.textContent ?? "").trim();
        },
        tick(): number {
            return globals.world.tick;
        },
        // A page nobody can scroll cannot prove the wheel was swallowed, so the
        // document is made scrollable for that one assertion.
        makeScrollable(): void {
            document.documentElement.style.overflow = "auto";
            document.body.style.overflow = "auto";
            document.body.style.height = "4000px";
        },
        restoreScrollable(): void {
            document.documentElement.style.overflow = "";
            document.body.style.overflow = "";
            document.body.style.height = "";
        },
        scrollTop(): number {
            return document.documentElement.scrollTop || document.body.scrollTop;
        },
    };
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let browser: BrowserSession | null = null;

beforeAll(async () => {
    if (!(await findBrowser())) {
        console.warn(
            "[browser] no Chromium-based browser found, so the browser scenarios are skipped; " +
                "set CHROME_PATH to one to run them",
        );
        return;
    }
    browser = await startBrowserSession({ headed: browserEnv("BROWSER_HEADED") === "1" });
    await browser.evaluate(`(${installProbe.toString()})()`);
    await browser.waitFor(
        "!!window.__obs && !!window.world && !!window.__probe",
        "the app to expose its debug handle",
        30_000,
    );

    // The picker is up at load and owns the pointer, so the first real click
    // starts the run — which is itself wiring worth checking: the run comes out
    // seeded with the era the player picked, and advances on its own.
    await browser.clickSelector('.era-card[data-era="Ice Age"]');
    await browser.clickSelector("#welcome-start");
    await browser.waitFor(
        "window.world.config.era && window.world.config.era.name === 'Ice Age'",
        "the picked era to be seeded into the run",
    );
    await browser.waitFor("window.world.tick > 5", "the run to start advancing");

    // A run starts at 500 ticks a second, which is a lot of world to keep ahead
    // of while a browser is also being driven: at that rate this file competes
    // with the rest of the suite for CPU and the world churns under the
    // scenarios. Step the speed ladder down; every scenario here works at any
    // speed, and the speed keys are exercised properly by the control bar test.
    for (let stepIndex = 0; stepIndex < 4; stepIndex++) await browser.press("Minus");
    const slowTick = await browser.evaluate<number>("window.world.tick");
    await browser.waitFor(
        `window.world.tick > ${slowTick}`,
        "the slowed run to keep advancing",
    );
}, 120_000);

afterAll(async () => {
    await browser?.close();
    browser = null;
});

/**
 * One browser scenario. Skips rather than fails without a browser, and keeps a
 * screenshot of any failure, because a picture of a broken camera says more
 * than an assertion about numbers.
 */
function scenario(
    name: string,
    body: (page: BrowserSession) => Promise<void> | void,
    timeoutMs = 30_000,
): void {
    it(
        name,
        async (context) => {
            const page = browser;
            context.skip(page === null, "no Chromium-based browser found on this machine");
            if (!page) return;
            expect(page).toBeDefined();
            onTestFailed(async () => {
                const shot = await page.screenshot(name);
                console.error(`[browser] ${name} failed; screenshot: ${shot ?? "unavailable"}`);
                console.error(`[browser] page errors: ${JSON.stringify(page.pageErrors)}`);
            });
            await body(page);
        },
        timeoutMs,
    );
}

const view = (page: BrowserSession): Promise<ObserverViewState> =>
    page.evaluate<ObserverViewState>("window.__obs.view()");
const probe = <T>(page: BrowserSession, expression: string): Promise<T> =>
    page.evaluate<T>(`window.__probe.${expression}`);
const resetView = async (page: BrowserSession): Promise<void> => {
    await page.evaluate("window.__obs.resetView()");
    await delay(60); // Let a frame apply the reset before anything is measured.
};
const centrePoint = async (page: BrowserSession): Promise<Point> => {
    const at = await probe<Point | null>(page, "canvasCentre()");
    expect(at, "the canvas has a point clear of the overlays").not.toBeNull();
    if (!at) throw new Error("the canvas has a point clear of the overlays");
    return at;
};

/**
 * Is the run actually advancing? The HUD label is written by the frame loop, so
 * it lags a frame and cannot be trusted to have settled — the tick count is the
 * ground truth.
 */
async function isAdvancing(page: BrowserSession, windowMs = 150): Promise<boolean> {
    const from = await probe<number>(page, "tick()");
    await delay(windowMs);
    return (await probe<number>(page, "tick()")) > from;
}

/** Leave the run moving, whatever state the previous scenario left it in. */
async function ensureRunning(page: BrowserSession): Promise<void> {
    if (await isAdvancing(page)) return;
    await page.press("Space");
    if (!(await isAdvancing(page))) throw new Error("the run would not start advancing");
}

/**
 * Pause the run, then click the herbivore nearest the middle of the canvas and
 * return it. Aiming a click at a specific body needs both: at the default
 * framing a body is a few pixels across, and the run advances hundreds of ticks
 * a second, so a click that spends a round trip in flight would land where the
 * animal used to be. Zooming in first makes the target larger as well.
 */
async function selectByClick(page: BrowserSession): Promise<{ id: number; middle: Point }> {
    if ((await probe<string>(page, "hudState()")) !== "已暫停") {
        await page.press("Space");
        await page.waitFor("window.__probe.hudState() === '已暫停'", "the run to pause");
    }
    const at = await centrePoint(page);
    for (let scrollStep = 0; scrollStep < 3; scrollStep++) await page.wheel(-120, at);
    const middle = await probe<Point>(page, "canvasMiddle()");
    const target = await probe<{ id: number; x: number; y: number } | null>(
        page,
        "animalOnCanvas(40)",
    );
    expect(target, "an animal drew clear of the overlays").not.toBeNull();
    if (!target) throw new Error("an animal drew clear of the overlays");

    await page.click({ x: target.x, y: target.y });

    expect((await view(page)).following, "the click must select what it landed on").toBe(
        target.id,
    );
    await page.waitFor("window.__probe.inspectorOpen()", "the inspector to open for that animal");
    return { id: target.id, middle };
}

describe("observer controls in a real browser", () => {
    scenario("zooms in on wheel up and out on wheel down without scrolling the page", async (page) => {
        await resetView(page);
        const at = await centrePoint(page);
        const before = await view(page);
        expect(before.zoom).toBeCloseTo(1, 9);

        await page.wheel(-120, at);
        const closer = await view(page);
        // Negative deltaY is a wheel up, and it has to pull the view in: the
        // direction every map and canvas tool uses, and the one the handler had
        // backwards.
        expect(closer.zoom).toBeGreaterThan(before.zoom);
        expect(closer.zoom).toBeCloseTo(1.12, 6);
        expect(closer.halfHeight).toBeLessThan(before.halfHeight);

        await page.wheel(120, at);
        const back = await view(page);
        expect(back.zoom).toBeCloseTo(before.zoom, 9);
        expect(back.halfHeight).toBeCloseTo(before.halfHeight, 9);

        // The gesture belongs to the canvas: a wheel over it must not also
        // scroll the document underneath.
        await probe(page, "makeScrollable()");
        try {
            await page.wheel(-120, at);
            await delay(150); // Give an unprevented scroll time to happen.
            expect(await probe<number>(page, "scrollTop()")).toBe(0);
        } finally {
            await probe(page, "restoreScrollable()");
        }
    });

    scenario("keeps the animal under the wheel pinned while the view zooms in", async (page) => {
        await resetView(page);
        // Paused: the animal has to hold still for the measurement.
        if ((await probe<string>(page, "hudState()")) !== "已暫停") {
            await page.press("Space");
            await page.waitFor("window.__probe.hudState() === '已暫停'", "the run to pause");
        }
        // Well clear of the middle, because a point at the middle hardly moves
        // under either behaviour and could not tell them apart.
        const target = await probe<{ id: number; x: number; y: number } | null>(
            page,
            "animalOnCanvas(60)",
        );
        expect(target, "an animal drew clear of the overlays").not.toBeNull();
        if (!target) return;
        const pinned = { x: target.x, y: target.y };
        const before = await view(page);

        for (let wheelIndex = 0; wheelIndex < 3; wheelIndex++) await page.wheel(-120, pinned);
        await page.evaluate("window.__probe.waitFrames(2)");

        const after = await view(page);
        const drawn = await probe<Point | null>(page, `animalScreenPoint(${target.id})`);
        expect(drawn, "the animal under the pointer is still alive").not.toBeNull();
        if (!drawn) return;
        expect(after.zoom, "the wheel has to zoom in").toBeGreaterThan(before.zoom * 1.3);
        // The regression this guards: the zoom used to be about the view centre,
        // so whatever the player pointed at slid away as the view pulled in.
        expect(
            Math.hypot(after.panX - before.panX, after.panZ - before.panZ),
            "an off-centre zoom has to reframe the view, or this proves nothing",
        ).toBeGreaterThan(1);
        expect(
            Math.hypot(drawn.x - pinned.x, drawn.y - pinned.y),
            "the animal under the cursor must stay under it",
        ).toBeLessThan(4);
    });

    scenario("pans with a real drag, moving the world with the pointer", async (page) => {
        await resetView(page);
        const start = await centrePoint(page);
        const want = { x: start.x + 64, y: start.y + 40 };
        expect(await probe<boolean>(page, `onCanvas(${want.x}, ${want.y})`)).toBe(true);
        const canvas = await probe<{ height: number }>(page, "canvasRect()");
        const before = await view(page);

        await page.drag(start, want);

        const after = await view(page);
        // Pixels to world units at the current framing, the same conversion the
        // pan handler uses. Dragging right and down moves the world with the
        // pointer, so the camera target moves the other way.
        const worldPerPx = (2 * before.halfHeight) / canvas.height;
        expect(after.zoom).toBeCloseTo(before.zoom, 9);
        expect(after.panX).toBeCloseTo(before.panX - (want.x - start.x) * worldPerPx, 3);
        expect(after.panZ).toBeCloseTo(before.panZ - (want.y - start.y) * worldPerPx, 3);
        expect(after.panX).toBeLessThan(before.panX);
        expect(after.panZ).toBeLessThan(before.panZ);
        expect(after.following).toBeNull();
    });

    scenario("does not select the animal the drag grabbed", async (page) => {
        await resetView(page);
        // Paused, and then zoomed in, so the body under the pointer is a target
        // worth aiming at rather than a couple of pixels.
        if ((await probe<string>(page, "hudState()")) !== "已暫停") {
            await page.press("Space");
            await page.waitFor("window.__probe.hudState() === '已暫停'", "the run to pause");
        }
        const at = await centrePoint(page);
        for (let scrollStep = 0; scrollStep < 3; scrollStep++) await page.wheel(-120, at);
        const target = await probe<{ id: number; x: number; y: number } | null>(
            page,
            "animalOnCanvas(40)",
        );
        expect(target, "an animal drew clear of the overlays").not.toBeNull();
        if (!target) throw new Error("an animal drew clear of the overlays");
        const grab = { x: target.x, y: target.y };

        await page.pointerDown(grab);
        await page.pointerMove({ x: grab.x + 70, y: grab.y + 50 });
        await delay(150);

        // A pan moves the world *with* the pointer, but not exactly one for one
        // (the conversion is a single pixels-to-world scale against a tilted
        // camera), so the body has drifted off the pointer. Ask where it is now
        // and put the pointer back on it — twice, because each correction moves
        // the world again — then lift. Pointers that travelled this far are the
        // gesture the drag guard exists for: landing on an animal must not
        // select it.
        for (let correction = 0; correction < 2; correction++) {
            const drawn = await probe<Point | null>(page, `animalScreenPoint(${target.id})`);
            expect(drawn, "the animal under the pointer is still alive").not.toBeNull();
            if (!drawn) throw new Error("the animal under the pointer is still alive");
            await page.pointerMove(drawn);
            await delay(150);
        }
        const landed = await probe<Point | null>(page, `animalScreenPoint(${target.id})`);
        expect(landed).not.toBeNull();
        if (!landed) throw new Error("the animal under the pointer is still alive");
        expect(
            Math.hypot(landed.x - grab.x, landed.y - grab.y),
            "the drag really did travel",
        ).toBeGreaterThan(10);
        await page.pointerUp(landed);
        await page.evaluate("window.__probe.waitFrames(3)");

        const after = await view(page);
        expect(after.following, "a drag must not select what it ends on").toBeNull();
        expect(await probe<boolean>(page, "inspectorOpen()")).toBe(false);
        expect(after.panX !== 0 || after.panZ !== 0).toBe(true);
    });

    scenario("selects the animal it clicked, and lets go on Escape", async (page) => {
        await resetView(page);
        const { id, middle } = await selectByClick(page);

        await delay(120); // A frame or two for the camera to take hold.
        const settled = await probe<Point | null>(page, `animalScreenPoint(${id})`);
        expect(settled, "the selected animal is drawn").not.toBeNull();
        if (!settled) throw new Error("the selected animal is drawn");
        // Selecting takes the camera to the animal, rather than only marking it.
        expect(Math.hypot(settled.x - middle.x, settled.y - middle.y)).toBeLessThan(12);
        expect((await view(page)).following).toBe(id);

        await page.press("Escape");
        const released = await view(page);
        expect(released.following).toBeNull();
        expect(await probe<boolean>(page, "inspectorOpen()")).toBe(false);
    });

    scenario("selects a tuft, and the card says how many bites it has left", async (page) => {
        await resetView(page);
        // Paused first: a tuft is a few pixels of blades, and the sim runs fast
        // enough that a click spends its round trip while the world moves.
        if ((await probe<string>(page, "hudState()")) !== "已暫停") {
            await page.press("Space");
            await page.waitFor("window.__probe.hudState() === '已暫停'", "the run to pause");
        }
        const at = await centrePoint(page);
        for (let scrollStep = 0; scrollStep < 3; scrollStep++) await page.wheel(-120, at);
        const target = await probe<{ id: number; x: number; y: number; bites: number } | null>(
            page,
            "plantOnCanvas(0)",
        );
        expect(target, "a tuft drew clear of the overlays").not.toBeNull();
        if (!target) throw new Error("target tuft not found");

        await page.click({ x: target.x, y: target.y });
        // The click sets the selection in the event handler, but the card is
        // written by the next frame, so wait for the card rather than assuming
        // it is there the moment the pointer event returns.
        await page.waitFor(
            "document.querySelector('#inspector').textContent.includes('草叢')",
            "the inspector card for the clicked tuft",
        );

        // Selecting a tuft must not hand the camera a follow: a plant never
        // moves, so a follow could only pin the view for nothing.
        expect((await view(page)).following, "a tuft must not be followed").toBeNull();

        const text = await page.evaluate<string>(
            "document.querySelector('#inspector').textContent",
        );
        const named = /草叢\s*#(\d+)/u.exec(text);
        expect(named, "the card must be about a tuft").not.toBeNull();
        if (!named) throw new Error("named tuft not found");
        const shown = /剩餘口數\s*(\d+) \/ (\d+)/u.exec(text);
        expect(shown, "the card must report the tuft's remaining bites").not.toBeNull();
        if (!shown) throw new Error("shown bites not found");
        expect(shown[2], "a full tuft holds the seeded bites").toBe("3");

        // The numbers on the card must be the sim's, for the tuft the card
        // names — a card reporting a stale or neighbouring tuft would still
        // look plausible, which is why this is read back rather than assumed.
        const selectedId = Number(named[1]);
        const live = await probe<number | null>(page, `plantBites(${selectedId})`);
        expect(live, "the card names a tuft that is standing").not.toBeNull();
        expect(shown[1], "the card shows the bites the sim says are left").toBe(String(live));
        expect(text, "a tuft is fertile the moment it appears").toContain("隨時（無成熟期）");

        // And the click must have landed on the tuft it was aimed at, give or
        // take the pick's own forgiveness.
        const drawn = await probe<Point | null>(page, `plantScreenPoint(${selectedId})`);
        expect(drawn, "the selected tuft is drawn").not.toBeNull();
        if (!drawn) throw new Error("drawn tuft not found");
        expect(
            Math.hypot(drawn.x - target.x, drawn.y - target.y),
            "the selected tuft is the one the click was aimed at",
        ).toBeLessThan(25);
    });

    scenario("keeps a followed animal at the middle as it moves, and hands the view back on a drag", async (page) => {
        await resetView(page);
        const { id, middle } = await selectByClick(page);
        await page.evaluate("window.__probe.waitFrames(3)");

        // Walk the animal's own position — the camera's only input — and check
        // it re-aims each time. A stale follow position would leave the body
        // behind by one nudge, which is tens of pixels at this zoom.
        const nudges: Array<[number, number]> = [
            [6, -4],
            [-7, 5],
            [5, 7],
        ];
        for (const [dx, dy] of nudges) {
            const moved = await probe<{ x: number; y: number } | null>(
                page,
                `nudgeAnimal(${id}, ${dx}, ${dy})`,
            );
            expect(moved, "the followed animal is still alive").not.toBeNull();
            await page.evaluate("window.__probe.waitFrames(3)");
            const drawn = await probe<Point | null>(page, `animalScreenPoint(${id})`);
            expect(drawn, "the followed animal is drawn").not.toBeNull();
            if (!drawn) throw new Error("the followed animal is drawn");
            expect(
                Math.hypot(drawn.x - middle.x, drawn.y - middle.y),
                `the camera must re-aim after the animal moved by (${dx}, ${dy})`,
            ).toBeLessThan(8);
        }

        // Taking the pointer is how a player says "I'll drive": the drag lets go
        // of the followed animal and pans, so the body it was pinned to is left
        // behind by however far the drag moved the world.
        const start = await centrePoint(page);
        await page.drag(start, { x: start.x + 60, y: start.y + 40 });
        await page.evaluate("window.__probe.waitFrames(3)");

        expect((await view(page)).following).toBeNull();
        const adrift = await probe<Point | null>(page, `animalScreenPoint(${id})`);
        expect(adrift, "the animal is still alive to be measured").not.toBeNull();
        if (!adrift) throw new Error("the animal is still alive to be measured");
        expect(Math.hypot(adrift.x - middle.x, adrift.y - middle.y)).toBeGreaterThan(20);
    });

    scenario("keeps the zoom, pan and framing across a real viewport resize", async (page) => {
        await resetView(page);
        const at = await centrePoint(page);
        for (let zoomStep = 0; zoomStep < 5; zoomStep++) await page.wheel(-120, at);
        await page.drag(at, { x: at.x + 48, y: at.y + 32 });

        const before = await view(page);
        expect(before.zoom).toBeGreaterThan(1.5);
        expect(before.panX).not.toBe(0);

        await page.resize(900, 620);
        await page.waitFor(
            "Math.abs(window.__obs.view().aspect - 900 / 620) < 0.01",
            "the resize to reach the camera's projection",
        );

        const after = await view(page);
        // The regression this guards, at the level the player feels it: a resize
        // changes the viewport, not the framing, so dragging a window or opening
        // a panel must not throw the zoom away.
        expect(after.zoom).toBeCloseTo(before.zoom, 9);
        expect(after.halfHeight).toBeCloseTo(before.halfHeight, 9);
        expect(after.panX).toBeCloseTo(before.panX, 9);
        expect(after.panZ).toBeCloseTo(before.panZ, 9);
        expect(after.aspect).toBeCloseTo(900 / 620, 6);

        const canvas = await probe<{ width: number; height: number }>(page, "canvasRect()");
        expect(Math.round(canvas.width)).toBe(900);
        expect(Math.round(canvas.height)).toBe(620);

        await page.resize(1280, 800);
        await page.waitFor(
            "Math.abs(window.__probe.canvasRect().width - 1280) < 1",
            "the viewport to be restored",
        );
    });

    scenario("resets the camera from the control bar, and drives pause and speed from the keyboard", async (page) => {
        await ensureRunning(page);
        const at = await centrePoint(page);
        await page.wheel(-120, at);
        await page.drag(at, { x: at.x + 40, y: at.y + 24 });
        expect((await view(page)).zoom).toBeGreaterThan(1);

        // 重置 is a player's only path to reset, so it has to reach the same
        // camera call the debug handle does.
        await page.clickSelector("#ctl-cam");
        const reset = await view(page);
        expect(reset.zoom).toBeCloseTo(1, 9);
        expect(reset.panX).toBeCloseTo(0, 9);
        expect(reset.panZ).toBeCloseTo(0, 9);
        expect(reset.following).toBeNull();

        await page.clickSelector("#ctl-pause");
        await page.waitFor("window.__probe.hudState() === '已暫停'", "the HUD to report the pause");
        expect(await isAdvancing(page, 300), "a paused run must not advance").toBe(false);
        const pausedTick = await probe<number>(page, "tick()");

        // Space resumes: the event reaches the window handler, and the button
        // that was just clicked must not swallow it as its own activation.
        await page.press("Space");
        await page.waitFor("window.__probe.hudState() === '運行中'", "the HUD to report the resume");
        await page.waitFor(`window.__probe.tick() > ${pausedTick}`, "the run to advance again");

        const label = await probe<string>(page, "speedLabel()");
        await page.press("Equal");
        await page.waitFor(
            `window.__probe.speedLabel() !== ${JSON.stringify(label)}`,
            "the speed ladder to step up",
        );
        await page.press("Minus");
        await page.waitFor(
            `window.__probe.speedLabel() === ${JSON.stringify(label)}`,
            "the speed ladder to step back down",
        );
    });

    scenario("drove every gesture without an uncaught page error", (page) => {
        // Anything a gesture threw — a missing element, a null camera — would be
        // swallowed by the frame loop and never reach the console.
        expect(page.pageErrors).toEqual([]);
    });
});
