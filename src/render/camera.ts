import * as THREE from "three";

/**
 * Observer camera for an orthographic god view: wheel zoom at the pointer,
 * drag to pan, optional follow of a selected entity, reset to the default
 * framing. Purely visual — never touches the simulation.
 *
 * `viewState` and `screenPoint` exist so something outside the app (the
 * browser harness in `tests/browser.test.ts`, or the console) can see what the
 * camera did and aim a real pointer at a specific animal.
 */

/**
 * A pointer position in client pixels: what a wheel's zoom is anchored on.
 * A `WheelEvent` satisfies this as it stands.
 */
export interface ZoomAnchor {
    readonly clientX: number;
    readonly clientY: number;
}

/** How far out and in the observer may zoom, as factors of the default framing. */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 12;
export interface ObserverViewState {
    /** Zoom factor, 1 = the whole-world framing the context was created with. */
    zoom: number;
    /** Pan offset from the world centre, in world units. */
    panX: number;
    panZ: number;
    /** Id of the entity the camera is tracking, or null. */
    following: number | null;
    dragging: boolean;
    /** Half-height of the view in world units: smaller means closer in. */
    halfHeight: number;
    /** Viewport aspect ratio the camera currently assumes (width / height). */
    aspect: number;
}
export class ObserverCamera {
    private readonly camera: THREE.OrthographicCamera;
    private readonly dom: HTMLElement;
    private readonly worldCenter: THREE.Vector3;
    private readonly worldWidth: number;
    private readonly worldHeight: number;
    private readonly defaultView: number;

    private panX = 0;
    private panZ = 0;
    private zoomFactor = 1;
    private followId: number | null = null;
    private followPos: THREE.Vector3 | null = null;
    private dragging = false;
    private lastX = 0;
    private lastY = 0;
    private readonly disposers: Array<() => void> = [];

    constructor(camera: THREE.OrthographicCamera, dom: HTMLElement, worldWidth: number, worldHeight: number) {
        this.camera = camera;
        this.dom = dom;
        this.worldWidth = worldWidth;
        this.worldHeight = worldHeight;
        this.worldCenter = new THREE.Vector3(worldWidth / 2, 0, worldHeight / 2);
        this.defaultView = Math.max(worldWidth, worldHeight) * 0.72;
        this.attach();
    }

    private attach(): void {
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            // Scroll up (negative deltaY) pulls the view closer, scroll down
            // pushes it away — the direction every map and canvas tool uses,
            // and what it pulls closer is what is under the cursor.
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            this.setZoom(this.zoomFactor * factor, event);
        };
        const onDown = (event: PointerEvent): void => {
            if (event.button !== 0) return;
            this.dragging = true;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        };
        const onMove = (event: PointerEvent): void => {
            if (!this.dragging) return;
            const dx = event.clientX - this.lastX;
            const dy = event.clientY - this.lastY;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
            this.followId = null;
            this.followPos = null;
            // Convert pixel drag to world units using the current view height.
            const rect = this.dom.getBoundingClientRect();
            const worldPerPx = (2 * this.viewHeight()) / rect.height;
            // Screen right/up maps to world (x, -z) in this top-down view.
            this.panBy(-dx * worldPerPx, -dy * worldPerPx);
        };
        const onUp = (): void => {
            this.dragging = false;
        };
        this.dom.addEventListener("wheel", onWheel, { passive: false });
        this.dom.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        this.disposers.push(() => {
            this.dom.removeEventListener("wheel", onWheel);
            this.dom.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        });
    }

    /** Current half-height of the camera's view in world units. */
    private viewHeight(): number {
        return this.defaultView / this.zoomFactor;
    }

    /**
     * Zoom, keeping the world point under `at` pinned to that pixel.
     *
     * A wheel is a gesture at a place, so the place is what gets pulled closer:
     * whatever the player pointed at stays under the cursor, the way every map
     * and canvas tool behaves. Zooming about the view centre is this call with
     * no anchor, which is what the debug handle and the harness use.
     *
     * A follow owns the framing — `apply` aims the camera at the animal rather
     * than at the pan — so while one is on the zoom stays centred on the animal
     * being watched. Anchoring on the pointer would mean moving a pan the
     * camera is ignoring: invisible at the time, and then a jump the player
     * never asked for when the follow ends.
     */
    setZoom(factor: number, at?: ZoomAnchor): void {
        const anchor = at && this.followId === null ? at : null;
        const held = anchor ? this.groundPoint(anchor) : null;
        this.zoomFactor = clamp(factor, ZOOM_MIN, ZOOM_MAX);
        this.applyProjection();
        if (anchor && held) {
            const now = this.groundPoint(anchor);
            // The world point under a given pixel is the camera's target plus a
            // constant offset for that pixel, so moving the target by the
            // difference puts the held point back under the pointer exactly.
            if (now) this.panBy(held.x - now.x, held.z - now.z);
        }
    }

    /**
     * Move the view centre by (dx, dz) world units, clamped to the world.
     *
     * A drag obeys that clamp, and an anchored zoom obeys it too: at the world's
     * edge the two cannot both hold, so the view stops at the edge rather than
     * drifting off into the empty space around the world.
     */
    private panBy(dx: number, dz: number): void {
        this.panX = clamp(this.panX + dx, -this.worldWidth / 2, this.worldWidth / 2);
        this.panZ = clamp(this.panZ + dz, -this.worldHeight / 2, this.worldHeight / 2);
    }

    /**
     * The point on the ground (y = 0) drawn under a client pixel, or null when
     * the camera is edge-on to the ground and no point is under it.
     */
    private groundPoint(at: ZoomAnchor): { x: number; z: number } | null {
        const rect = this.dom.getBoundingClientRect();
        const ndcX = ((at.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = 1 - ((at.clientY - rect.top) / rect.height) * 2;
        // Two points on the pixel's own ray: an orthographic camera's rays do
        // not fan out, so the ground is a single intersection with that line.
        // The matrices `unproject` reads are refreshed by the renderer's own
        // render, which has not run yet on the very first frame.
        this.camera.updateMatrixWorld();
        const near = new THREE.Vector3(ndcX, ndcY, -1).unproject(this.camera);
        const far = new THREE.Vector3(ndcX, ndcY, 1).unproject(this.camera);
        const rise = far.y - near.y;
        if (Math.abs(rise) < 1e-9) return null;
        const fraction = -near.y / rise;
        return { x: near.x + (far.x - near.x) * fraction, z: near.z + (far.z - near.z) * fraction };
    }

    getZoom(): number {
        return this.zoomFactor;
    }

    /** Read-only snapshot of the framing, for tests and the debug console. */
    viewState(): ObserverViewState {
        return {
            zoom: this.zoomFactor,
            panX: this.panX,
            panZ: this.panZ,
            following: this.followId,
            dragging: this.dragging,
            halfHeight: (this.camera.top - this.camera.bottom) / 2,
            aspect: this.camera.right / this.camera.top,
        };
    }

    /**
     * Where a point in the world is drawn, in CSS pixels relative to the
     * viewport.
     *
     * This is the inverse of the pick mapping the app uses for click-to-select:
     * picking turns a screen point into a ray, and this turns a world position
     * back into the pixel it lands on. Something driving the page from outside
     * can only name an entity by id, so without this it has no way to aim a
     * real click at one. `elevation` is the height above the ground to aim at —
     * an animal's body sits at about 0.6.
     */
    screenPoint(x: number, y: number, elevation = 0): { x: number; y: number } {
        // The frame loop only sets position/lookAt; the matrices that
        // `project` reads are refreshed by the renderer's own render, which has
        // not run yet on the very first frame. Refresh them here so the result
        // does not depend on when the frame loop last ran.
        this.camera.updateMatrixWorld();
        const projected = new THREE.Vector3(x, elevation, y).project(this.camera);
        const rect = this.dom.getBoundingClientRect();
        return {
            x: rect.left + ((projected.x + 1) / 2) * rect.width,
            y: rect.top + ((1 - projected.y) / 2) * rect.height,
        };
    }

    resetView(): void {
        this.zoomFactor = 1;
        this.panX = 0;
        this.panZ = 0;
        this.followId = null;
        this.followPos = null;
        this.applyProjection();
    }

    /** Follow an entity's world position each frame (set position via updateFromSim). */
    follow(id: number | null): void {
        this.followId = id;
        if (id === null) this.followPos = null;
    }

    isFollowing(): boolean {
        return this.followId !== null;
    }

    isDragging(): boolean {
        return this.dragging;
    }

    /** Feed the followed entity's sim-space position (x, y) each frame. */
    updateFromSim(x: number | null, y: number | null): void {
        if (this.followId !== null && x !== null && y !== null) {
            this.followPos = new THREE.Vector3(x, 0, y);
        }
    }

    /** Apply pan/zoom/follow to the camera. Call once per frame. */
    apply(): void {
        const targetX = this.followPos ? this.followPos.x : this.worldCenter.x + this.panX;
        const targetZ = this.followPos ? this.followPos.z : this.worldCenter.z + this.panZ;
        // Keep the original oblique offset direction but scale its length with zoom.
        const base = this.camera.userData.baseOffset as THREE.Vector3 | undefined;
        if (base) {
            const s = 1 / Math.sqrt(this.zoomFactor);
            this.camera.position.set(
                targetX + base.x * s,
                base.y * s,
                targetZ + base.z * s,
            );
        } else {
            this.camera.position.set(targetX, this.camera.position.y, targetZ);
        }
        this.camera.lookAt(targetX, 0, targetZ);
    }

    private applyProjection(): void {
        const vh = this.viewHeight();
        const aspect = this.camera.right / this.camera.top;
        this.camera.left = -vh * aspect;
        this.camera.right = vh * aspect;
        this.camera.top = vh;
        this.camera.bottom = -vh;
        this.camera.updateProjectionMatrix();
    }

    dispose(): void {
        for (const d of this.disposers) d();
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
