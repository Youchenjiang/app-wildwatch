import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Scene, Vector3, type WebGLRenderer } from "three";
import { ObserverCamera } from "../src/render/camera";
import { resizeContext, type RenderContext } from "../src/render/scene";

/** A context with no WebGL: only the pieces resizeContext touches. */
function renderContext(): RenderContext {
    const view = 144; // max(width, height) * 0.72 for the 200x200 default world
    const camera = new OrthographicCamera(-view, view, view, -view, 0.1, 500);
    // Framed the way createRenderContext frames it — oblique, looking at the
    // middle of the world. A wheel's zoom is anchored on the ground under a
    // pixel, so a camera that is not pointed at the ground has none to anchor.
    const centre = new Vector3(100, 0, 100);
    camera.position.copy(centre).add(new Vector3(-42, 118, 42));
    camera.lookAt(centre);
    (camera.userData as { baseOffset?: Vector3 }).baseOffset = camera.position
        .clone()
        .sub(centre);
    const renderer = { setSize: vi.fn() } as unknown as WebGLRenderer;
    return {
        camera,
        renderer,
        view,
        scene: new Scene(),
        atmosphere: {} as RenderContext["atmosphere"],
    };
}

/** A DOM stub that records its listeners, so a test can fire events at them. */
interface ListenerDom {
    dom: HTMLElement;
    fire: (type: string, event: unknown) => void;
    listenerCount: (type: string) => number;
}

function listenerDom(): ListenerDom {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const dom = {
        addEventListener: (type: string, fn: (event: unknown) => void): void => {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        removeEventListener: (type: string, fn: (event: unknown) => void): void => {
            listeners.set(type, (listeners.get(type) ?? []).filter((handler) => handler !== fn));
        },
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            right: 640,
            bottom: 360,
            width: 640,
            height: 360,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }),
    } as unknown as HTMLElement;
    return {
        dom,
        fire: (type, event) => {
            for (const handler of listeners.get(type) ?? []) handler(event);
        },
        listenerCount: (type) => (listeners.get(type) ?? []).length,
    };
}

function stubWindow(): void {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

/** Centre of the stubbed 640x360 viewport, in client pixels. */
const CENTRE = { x: 320, y: 180 };

/** An observer attached to a real listener stub, plus a way to send it a wheel. */
function wiredObserver(): {
    ctx: RenderContext;
    observer: ObserverCamera;
    scroll: (
        deltaY: number,
        at?: { x: number; y: number },
    ) => { preventDefault: ReturnType<typeof vi.fn> };
    listenerCount: (type: string) => number;
} {
    stubWindow();
    const ctx = renderContext();
    const stub = listenerDom();
    const observer = new ObserverCamera(ctx.camera, stub.dom, 200, 200);
    return {
        ctx,
        observer,
        scroll: (deltaY, at = CENTRE) => {
            const event = { deltaY, clientX: at.x, clientY: at.y, preventDefault: vi.fn() };
            stub.fire("wheel", event);
            return event;
        },
        listenerCount: stub.listenerCount,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("viewport resize", () => {
    it("keeps the observer's zoom instead of falling back to the default view", () => {
        stubWindow();
        const ctx = renderContext();
        const observer = new ObserverCamera(ctx.camera, listenerDom().dom, 200, 200);
        observer.setZoom(6);
        const zoomed = ctx.camera.top;
        expect(zoomed).toBeCloseTo(ctx.view / 6, 9);

        resizeContext(ctx, 1280, 720);

        // The regression this guards: the rect used to be re-derived from the
        // default view, so any resize — a window drag, a dev tools or side
        // panel opening — snapped a zoomed-in view back to the whole world.
        expect(ctx.camera.top, "the zoom was reset to the default view").toBeCloseTo(zoomed, 9);
        expect(ctx.camera.bottom).toBeCloseTo(-zoomed, 9);
        expect(observer.getZoom()).toBe(6);
        observer.dispose();
    });

    it("still fits the viewport, so the width follows the new aspect", () => {
        const ctx = renderContext();
        resizeContext(ctx, 1280, 720);

        expect(ctx.camera.right / ctx.camera.top).toBeCloseTo(1280 / 720, 9);
        expect(ctx.camera.right).toBeCloseTo(ctx.view * (1280 / 720), 9);
        expect(ctx.renderer.setSize).toHaveBeenCalledWith(1280, 720);
    });

    it("leaves an unzoomed view at the default framing", () => {
        const ctx = renderContext();
        resizeContext(ctx, 800, 400);

        expect(ctx.camera.top).toBeCloseTo(ctx.view, 9);
        expect(ctx.camera.bottom).toBeCloseTo(-ctx.view, 9);
    });

    it("zooms again into the viewport it was last resized to", () => {
        // The observer reads the aspect back off the camera when it applies a
        // zoom, so a resize has to leave the aspect where it found it — a fix
        // that only skipped updating the camera would stretch the world instead.
        stubWindow();
        const ctx = renderContext();
        const observer = new ObserverCamera(ctx.camera, listenerDom().dom, 200, 200);

        resizeContext(ctx, 1600, 800);
        observer.setZoom(4);

        expect(ctx.camera.right / ctx.camera.top).toBeCloseTo(2, 9);
        expect(ctx.camera.top).toBeCloseTo(ctx.view / 4, 9);
        observer.dispose();
    });
});

describe("wheel zoom direction", () => {
    it("zooms in when scrolling up", () => {
        const { ctx, observer, scroll } = wiredObserver();

        scroll(-120);

        // Scrolling up has to pull the view closer, not push it away: the
        // handler used to treat a negative deltaY as zoom *out*.
        expect(observer.getZoom(), "scrolling up should zoom in").toBeGreaterThan(1);
        expect(ctx.camera.top).toBeLessThan(ctx.view);
        expect(ctx.camera.top).toBeCloseTo(ctx.view / observer.getZoom(), 9);
        observer.dispose();
    });

    it("zooms out when scrolling down", () => {
        const { ctx, observer, scroll } = wiredObserver();

        scroll(120);

        expect(observer.getZoom(), "scrolling down should zoom out").toBeLessThan(1);
        expect(ctx.camera.top).toBeGreaterThan(ctx.view);
        expect(ctx.camera.top).toBeCloseTo(ctx.view / observer.getZoom(), 9);
        observer.dispose();
    });

    it("treats the two directions as opposites, so scrolling back undoes a scroll", () => {
        const { ctx, observer, scroll } = wiredObserver();

        scroll(-120);
        const zoomedIn = ctx.camera.top;
        scroll(120);

        expect(zoomedIn).toBeLessThan(ctx.view);
        expect(observer.getZoom()).toBeCloseTo(1, 9);
        expect(ctx.camera.top).toBeCloseTo(ctx.view, 9);
        observer.dispose();
    });

    it("swallows the gesture so the page does not scroll underneath the view", () => {
        const { observer, scroll, listenerCount } = wiredObserver();
        expect(listenerCount("wheel")).toBe(1);

        const event = scroll(120);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        observer.dispose();
        expect(listenerCount("wheel")).toBe(0);
    });
});

describe("wheel zoom at the pointer", () => {
    /** The pixel a world point is drawn at, which is what a wheel aims at. */
    const heldAt = (observer: ObserverCamera, x: number, z: number) => observer.screenPoint(x, z);

    it("keeps the world point under the cursor exactly where it is", () => {
        const { observer, scroll } = wiredObserver();
        observer.apply();
        // Off to one side of the middle: a point at the centre barely moves
        // under either behaviour, so it could not tell them apart.
        const held = { x: 150, z: 140 };
        const at = heldAt(observer, held.x, held.z);
        expect(Math.abs(at.x - CENTRE.x), "the wheel has to land off-centre").toBeGreaterThan(20);

        scroll(-120, at);
        // The frame loop's own call, so the check covers where the camera is
        // actually put and not only the projection.
        observer.apply();

        const after = heldAt(observer, held.x, held.z);
        expect(observer.getZoom(), "the wheel has to zoom in").toBeCloseTo(1.12, 9);
        expect(
            Math.hypot(after.x - at.x, after.y - at.y),
            "the world point under the pointer moved",
        ).toBeLessThan(0.05);
        expect(
            observer.viewState().panX,
            "zooming off-centre has to reframe the view",
        ).not.toBeCloseTo(0, 6);
        observer.dispose();
    });

    it("pins the point through a scroll back out, so the view returns to where it was", () => {
        const { observer, scroll } = wiredObserver();
        observer.apply();
        const held = { x: 150, z: 140 };
        const at = heldAt(observer, held.x, held.z);

        scroll(-120, at);
        observer.apply();
        const zoomedIn = observer.viewState();
        scroll(120, at);
        observer.apply();

        expect(zoomedIn.panX, "the zoom in really did reframe").not.toBeCloseTo(0, 6);
        expect(observer.getZoom()).toBeCloseTo(1, 9);
        expect(observer.viewState().panX).toBeCloseTo(0, 9);
        expect(observer.viewState().panZ).toBeCloseTo(0, 9);
        const after = heldAt(observer, held.x, held.z);
        expect(Math.hypot(after.x - at.x, after.y - at.y)).toBeLessThan(0.05);
        observer.dispose();
    });

    it("leaves the view alone when the wheel is at the middle", () => {
        // The centre of the screen is the camera's own target, so there is
        // nothing to correct there — an anchored zoom and the old centred one
        // agree exactly.
        const { observer, scroll } = wiredObserver();
        observer.apply();

        scroll(-120);

        expect(observer.getZoom()).toBeCloseTo(1.12, 9);
        expect(observer.viewState().panX).toBeCloseTo(0, 9);
        expect(observer.viewState().panZ).toBeCloseTo(0, 9);
        observer.dispose();
    });

    it("leaves the framing to a follow rather than to the pointer", () => {
        const { observer, scroll } = wiredObserver();
        observer.follow(7);
        observer.updateFromSim(150, 140);
        observer.apply();
        const at = heldAt(observer, 150, 140);

        scroll(-120, at);
        observer.apply();

        expect(observer.getZoom()).toBeCloseTo(1.12, 9);
        // The camera is aimed at the animal, not at the pan, so the anchor has
        // nothing of its own to move — and must not move the pan behind the
        // scenes for the moment the follow is released.
        expect(observer.viewState().panX).toBeCloseTo(0, 9);
        expect(observer.viewState().panZ).toBeCloseTo(0, 9);
        observer.dispose();
    });

    it("keeps the pan inside the world however far the pointer is", () => {
        const { observer, scroll } = wiredObserver();
        observer.apply();
        // The viewport's own corner: at the default framing the ground under it
        // is well outside the world, so the correction asks to pan past the
        // edge. It has to stop where a drag would.
        for (let stepIndex = 0; stepIndex < 40; stepIndex++) scroll(-120, { x: 0, y: 0 });
        observer.apply();

        const state = observer.viewState();
        expect(observer.getZoom()).toBeCloseTo(12, 9);
        expect(Math.abs(state.panX), "the pan left the world").toBeLessThanOrEqual(100);
        expect(Math.abs(state.panZ), "the pan left the world").toBeLessThanOrEqual(100);
        expect(Math.hypot(state.panX, state.panZ), "the pan never moved").toBeGreaterThan(20);
        observer.dispose();
    });
});
