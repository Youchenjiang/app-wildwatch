import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera, Scene, type WebGLRenderer } from "three";
import { ObserverCamera } from "../src/render/camera";
import { resizeContext, type RenderContext } from "../src/render/scene";

/** A context with no WebGL: only the pieces resizeContext touches. */
function renderContext(): RenderContext {
    const view = 144; // max(width, height) * 0.72 for the 200x200 default world
    const camera = new OrthographicCamera(-view, view, view, -view, 0.1, 500);
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
    const listeners = new Map<string, Array<(event: any) => void>>();
    const dom = {
        addEventListener: (type: string, fn: (event: any) => void): void => {
            listeners.set(type, [...(listeners.get(type) ?? []), fn]);
        },
        removeEventListener: (type: string, fn: (event: any) => void): void => {
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

/** An observer attached to a real listener stub, plus a way to send it a wheel. */
function wiredObserver(): {
    ctx: RenderContext;
    observer: ObserverCamera;
    scroll: (deltaY: number) => { preventDefault: ReturnType<typeof vi.fn> };
    listenerCount: (type: string) => number;
} {
    stubWindow();
    const ctx = renderContext();
    const stub = listenerDom();
    const observer = new ObserverCamera(ctx.camera, stub.dom, 200, 200);
    return {
        ctx,
        observer,
        scroll: (deltaY) => {
            const event = { deltaY, preventDefault: vi.fn() };
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
