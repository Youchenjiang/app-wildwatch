/**
 * Browser-level harness: a real Chromium running the real app.
 *
 * The unit tests around the observer camera (`tests/camera.test.ts`) drive a
 * stubbed DOM, which is the right level for the camera's arithmetic but blind
 * to the wiring — whether the wheel listener sits on the element the pointer is
 * actually over, whether a pan also selects the animal it crossed, whether a
 * window resize reaches `resizeContext` at all. Those failures only exist once
 * a browser owns the events, so this harness drives the page the way a player
 * does: real wheel gestures, real pointer presses and releases, real key
 * presses, a real viewport resize. It then reads back what the app did through
 * `window.__obs`.
 *
 * It talks to Chrome DevTools Protocol directly on Node's global `WebSocket`
 * plus `fetch`, instead of adding a browser-automation dependency: the project
 * has no e2e tooling, and Playwright or Puppeteer would be a large addition for
 * a handful of scenarios. Input goes through CDP's `Input` domain, so the
 * events are trusted and travel the browser's real input pipeline (which is
 * what mints the pointer events the app listens for), not synthetic
 * `dispatchEvent` calls.
 *
 * The app is served by its own Vite dev server on an ephemeral port, started
 * here with `configFile: false` so it can never collide with a `npm run dev`
 * the developer already has running.
 *
 * Nothing here is app-specific. The scenarios decide what to evaluate and
 * where to click; this file only knows how to launch, drive and read a page.
 * Expressions passed to `evaluate` must return JSON-serializable values.
 */
import { createServer, type ViteDevServer } from "vite";

/* -------------------------------------------------------------------------- *
 * Node builtins without @types/node
 * -------------------------------------------------------------------------- */

/**
 * Node builtins, reached through a non-literal specifier.
 *
 * This project ships no node typings — `tsconfig` lists only `vite/client` — so
 * a literal `import("node:fs")` is a compile error. The variable hides the
 * specifier from the type checker and `@vite-ignore` tells vite not to rewrite
 * it; adding `@types/node` for the sake of a test harness would push node
 * globals into the type space of an app that runs entirely in a browser.
 */
const loadBuiltin = (specifier: string): Promise<unknown> =>
    import(/* @vite-ignore */ specifier);

interface ChildProcessHandle {
    readonly stderr: { on(event: string, listener: (chunk: unknown) => void): void } | null;
    readonly stdout: { on(event: string, listener: (chunk: unknown) => void): void } | null;
    kill(): void;
    once(event: string, listener: () => void): void;
}

interface ChildProcessModule {
    spawn(
        command: string,
        args: readonly string[],
        options: { stdio: readonly string[] },
    ): ChildProcessHandle;
}

interface FsModule {
    mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
    writeFile(path: string, data: string, encoding: string): Promise<void>;
    rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
    stat(path: string): Promise<{ isFile(): boolean }>;
}

interface OsModule {
    tmpdir(): string;
}

interface ProcessGlobals {
    platform: string;
    env: Record<string, string | undefined>;
}

/** `process` is untyped in this project, so reach it through the global. */
const processGlobals = (globalThis as unknown as { process?: ProcessGlobals }).process;

/** An environment variable, for the switches this harness honours. */
export function browserEnv(name: string): string | undefined {
    return processGlobals?.env[name];
}

/* -------------------------------------------------------------------------- *
 * Finding and launching a browser
 * -------------------------------------------------------------------------- */

/** Where a Chromium-family browser usually lives, most specific first. */
const BROWSER_CANDIDATES: Record<string, readonly string[]> = {
    win32: [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ],
    darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    ],
};

/**
 * Path to a usable browser, or null. `CHROME_PATH` (or `BROWSER_PATH`) wins, so
 * a machine with Chrome somewhere unusual can still run the scenarios.
 */
export async function findBrowser(): Promise<string | null> {
    const fs = (await loadBuiltin("node:fs/promises")) as FsModule;
    const platform = processGlobals?.platform ?? "linux";
    const override = processGlobals?.env.CHROME_PATH ?? processGlobals?.env.BROWSER_PATH;
    const candidates = [
        ...(override ? [override] : []),
        ...(BROWSER_CANDIDATES[platform] ?? BROWSER_CANDIDATES.linux),
    ];
    for (const candidate of candidates) {
        try {
            const info = await fs.stat(candidate);
            if (info.isFile()) return candidate;
        } catch {
            // Not here; try the next candidate.
        }
    }
    return null;
}

/* -------------------------------------------------------------------------- *
 * A thin DevTools Protocol client
 * -------------------------------------------------------------------------- */

interface CdpEnvelope {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message: string };
}

interface ExceptionDetails {
    text?: string;
    exception?: { description?: string; value?: unknown };
}

class CdpClient {
    private nextId = 1;
    private readonly pending = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    private readonly listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();

    constructor(private readonly socket: WebSocket) {
        socket.addEventListener("message", (event) => this.receive(String(event.data)));
    }

    static async connect(url: string): Promise<CdpClient> {
        const socket = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve(), { once: true });
            socket.addEventListener("error", () =>
                reject(new Error(`could not open the devtools socket at ${url}`)),
            );
        });
        return new CdpClient(socket);
    }

    private receive(raw: string): void {
        let message: CdpEnvelope;
        try {
            message = JSON.parse(raw) as CdpEnvelope;
        } catch {
            return; // Protocol expects JSON; anything else is not ours.
        }
        if (typeof message.id === "number") {
            const waiter = this.pending.get(message.id);
            if (!waiter) return;
            this.pending.delete(message.id);
            if (message.error) waiter.reject(new Error(message.error.message));
            else waiter.resolve(message.result);
            return;
        }
        if (typeof message.method === "string") {
            for (const listener of this.listeners.get(message.method) ?? []) {
                listener(message.params ?? {});
            }
        }
    }

    send(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
    ): Promise<Record<string, unknown>> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve((value ?? {}) as Record<string, unknown>),
                reject,
            });
            this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }

    on(method: string, listener: (params: Record<string, unknown>) => void): void {
        this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
    }

    close(): void {
        this.socket.close();
    }
}

/* -------------------------------------------------------------------------- *
 * The session
 * -------------------------------------------------------------------------- */

export interface Point {
    x: number;
    y: number;
}

export interface BrowserSession {
    /** Uncaught exceptions and error-level console output since page load. */
    readonly pageErrors: string[];
    /** Evaluate in the page; the expression must return a serializable value. */
    evaluate<T>(expression: string): Promise<T>;
    /** Poll an expression until it is truthy, or fail with what was expected. */
    waitFor<T>(expression: string, what: string, timeoutMs?: number): Promise<T>;
    click(at: Point): Promise<void>;
    /**
     * Raw drag pieces, for a gesture that has to inspect the page mid-drag. A
     * pan moves the world *roughly* with the pointer, so a test that needs the
     * pointer to end on a particular thing has to ask where that thing is now.
     */
    pointerDown(at: Point): Promise<void>;
    pointerMove(at: Point): Promise<void>;
    pointerUp(at: Point): Promise<void>;
    /** Click the centre of a selector, refusing if something covers it. */
    clickSelector(selector: string): Promise<Point>;
    /**
     * Press, move, release. `settleMs` holds the pointer still at the end of
     * the drag before letting go, which gives the app frames to draw the pan it
     * is applying — picking and dragging are read back off the last rendered
     * camera, so a gesture that outruns the frame loop measures a stale view.
     */
    drag(from: Point, to: Point, steps?: number, settleMs?: number): Promise<void>;
    wheel(deltaY: number, at: Point): Promise<void>;
    /** Press and release a key, addressed by its `event.code`. */
    press(code: KeyCode): Promise<void>;
    /** Really change the viewport, as a window resize would. */
    resize(width: number, height: number): Promise<void>;
    /** Capture the page to `tmp/browser/<label>.png`; returns the path. */
    screenshot(label: string): Promise<string | null>;
    close(): Promise<void>;
}

/** The keys the scenarios press, with the virtual key code CDP wants. */
export type KeyCode = "Space" | "Escape" | "KeyR" | "Equal" | "Minus";

const KEYS: Record<KeyCode, { key: string; text?: string; vk: number }> = {
    Space: { key: " ", text: " ", vk: 32 },
    Escape: { key: "Escape", vk: 27 },
    KeyR: { key: "r", text: "r", vk: 82 },
    Equal: { key: "=", text: "=", vk: 187 },
    Minus: { key: "-", text: "-", vk: 189 },
};

export interface BrowserOptions {
    /** Show a real window instead of running headless (debugging aid). */
    headed?: boolean;
    width?: number;
    height?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const randomPortOffset = (range: number): number => {
    const buffer = new Uint16Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) % range;
};

/** Start a dev server and a browser, and navigate it at the app. */
export async function startBrowserSession(options: BrowserOptions = {}): Promise<BrowserSession> {
    const executable = await findBrowser();
    if (!executable) {
        throw new Error(
            "no Chromium-based browser found; set CHROME_PATH to one to run the browser scenarios",
        );
    }
    const { spawn } = (await loadBuiltin("node:child_process")) as ChildProcessModule;
    const fs = (await loadBuiltin("node:fs/promises")) as FsModule;
    const os = (await loadBuiltin("node:os")) as OsModule;
    const width = options.width ?? 1280;
    const height = options.height ?? 800;

    // The repo config pins port 5173 with strictPort, which would fight a dev
    // server the developer already has running. This server is only for the
    // harness, so it picks its own port and ignores the config file.
    const server: ViteDevServer = await createServer({
        configFile: false,
        logLevel: "warn",
        server: {
            host: "127.0.0.1",
            port: 5200 + randomPortOffset(300),
            strictPort: false,
        },
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error("the harness dev server did not report a local URL");

    const debugPort = 9400 + randomPortOffset(400);
    const profile = `${os.tmpdir()}/freebuff-browser-${Date.now().toString(36)}`;
    const flags = [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-features=Translate,MediaRouter",
        // Keep the frame loop and rAF running like a foreground tab: the app
        // advances the sim per frame, so a throttled tab would stall the run.
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        // Headless has no GPU; this lets the WebGL renderer fall back to
        // software rendering instead of failing to get a context.
        "--enable-unsafe-swiftshader",
        "--hide-scrollbars",
        `--window-size=${width},${height}`,
        "about:blank",
    ];
    const chrome = spawn(executable, [
        ...(options.headed ? [] : ["--headless=new"]),
        ...flags,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let stderrTail = "";
    chrome.stderr?.on("data", (chunk) => {
        stderrTail = `${stderrTail}${String(chunk)}`.slice(-2000);
    });

    // Chrome prints "DevTools listening on ws://..." once; poll the HTTP
    // endpoint instead, which works the same for a fixed debug port.
    let browserSocket = "";
    const deadline = Date.now() + 20_000;
    while (!browserSocket && Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
            const version = (await response.json()) as { webSocketDebuggerUrl?: string };
            browserSocket = version.webSocketDebuggerUrl ?? "";
        } catch {
            await delay(150);
        }
    }
    if (!browserSocket) {
        chrome.kill();
        await server.close();
        throw new Error(`the browser never opened its debugger port:\n${stderrTail}`);
    }

    const browser = await CdpClient.connect(browserSocket);
    const { targetId } = (await browser.send("Target.createTarget", { url: "about:blank" })) as {
        targetId: string;
    };
    const { sessionId } = (await browser.send("Target.attachToTarget", {
        targetId,
        flatten: true,
    })) as { sessionId: string };

    const session = new BrowserPage(browser, sessionId, chrome, server, fs, profile, url, width, height);
    try {
        await session.prepare();
        return session;
    } catch (error) {
        await session.close();
        throw error;
    }
}

class BrowserPage implements BrowserSession {
    readonly pageErrors: string[] = [];

    constructor(
        private readonly browser: CdpClient,
        private readonly sessionId: string,
        private readonly chrome: ChildProcessHandle,
        private readonly server: ViteDevServer,
        private readonly fs: FsModule,
        private readonly profile: string,
        private readonly url: string,
        private readonly width: number,
        private readonly height: number,
    ) {}

    private send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        return this.browser.send(method, params, this.sessionId);
    }

    /** Wire up the domains, size the viewport, then load the app. */
    async prepare(): Promise<void> {
        this.browser.on("Runtime.exceptionThrown", (params) => {
            const details = params.exceptionDetails as ExceptionDetails | undefined;
            this.pageErrors.push(
                details?.exception?.description ?? details?.text ?? "uncaught exception",
            );
        });
        this.browser.on("Runtime.consoleAPICalled", (params) => {
            if (params.type !== "error") return;
            const args = (params.args as Array<{ value?: unknown; description?: string }>) ?? [];
            const formatted = args
                .map((arg) => {
                    if (arg.value !== undefined) {
                        return typeof arg.value === "object" && arg.value !== null
                            ? JSON.stringify(arg.value)
                            : String(arg.value);
                    }
                    return arg.description ?? "";
                })
                .join(" ");
            this.pageErrors.push(`console.error: ${formatted}`);
        });
        this.browser.on("Log.entryAdded", (params) => {
            const entry = params.entry as { level?: string; text?: string; url?: string } | undefined;
            if (entry?.level !== "error") return;
            // A missing favicon is the browser's own request, not the app
            // failing at anything, and no scenario can influence it.
            if ((entry.url ?? "").endsWith("/favicon.ico")) return;
            const urlSuffix = entry.url ? ` (${entry.url})` : "";
            this.pageErrors.push(`log: ${entry.text ?? ""}${urlSuffix}`);
        });

        // Listeners first, so a failure while loading the app is captured.
        await this.send("Runtime.enable");
        await this.send("Log.enable");
        await this.send("Page.enable");
        // Size the viewport before the first paint: the app measures its
        // container on load, so navigating first and resizing after would test
        // a resize instead of the initial layout.
        await this.resize(this.width, this.height);
        await this.send("Page.navigate", { url: this.url });
        await this.waitFor(
            "document.readyState === 'complete'",
            `the app to finish loading from ${this.url}`,
            30_000,
        );
    }

    async evaluate<T>(expression: string): Promise<T> {
        const result = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        const details = result.exceptionDetails as ExceptionDetails | undefined;
        if (details) {
            const description =
                details.exception?.description ?? details.text ?? JSON.stringify(details);
            throw new Error(`page expression failed: ${description}\n  ${expression}`);
        }
        return (result.result as { value?: T })?.value as T;
    }

    async waitFor<T>(expression: string, what: string, timeoutMs = 15_000): Promise<T> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            // A reference error mid-boot is expected; only a timeout is fatal.
            const value = await this.evaluate<T | false>(
                `(() => { try { return (${expression}); } catch (error) { return false; } })()`,
            );
            if (value) return value;
            if (Date.now() > deadline) {
                const errors = this.pageErrors.length > 0 ? `\n  page errors: ${this.pageErrors.join(" | ")}` : "";
                throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${errors}`);
            }
            await delay(100);
        }
    }

    private async mouse(
        type: "mousePressed" | "mouseReleased" | "mouseMoved",
        at: Point,
        buttons: number,
    ): Promise<void> {
        await this.send("Input.dispatchMouseEvent", {
            type,
            x: at.x,
            y: at.y,
            button: "left",
            buttons,
            clickCount: 1,
            pointerType: "mouse",
        });
    }

    async click(at: Point): Promise<void> {
        await this.mouse("mousePressed", at, 1);
        await this.mouse("mouseReleased", at, 0);
    }

    async clickSelector(selector: string): Promise<Point> {
        const at = await this.evaluate<Point>(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) throw new Error("no element matches " + ${JSON.stringify(selector)});
            const box = element.getBoundingClientRect();
            const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
            const hit = document.elementFromPoint(point.x, point.y);
            if (!hit || !(hit === element || element.contains(hit))) {
                throw new Error(${JSON.stringify(selector)} + " is covered by " + (hit ? hit.tagName : "nothing"));
            }
            return point;
        })()`);
        await this.click(at);
        return at;
    }

    pointerDown(at: Point): Promise<void> {
        return this.mouse("mousePressed", at, 1);
    }

    pointerMove(at: Point): Promise<void> {
        return this.mouse("mouseMoved", at, 1);
    }

    pointerUp(at: Point): Promise<void> {
        return this.mouse("mouseReleased", at, 0);
    }

    async drag(from: Point, to: Point, steps = 8, settleMs = 0): Promise<void> {
        await this.pointerDown(from);
        for (let step = 1; step <= steps; step++) {
            const progress = step / steps;
            await this.pointerMove({
                x: from.x + (to.x - from.x) * progress,
                y: from.y + (to.y - from.y) * progress,
            });
        }
        if (settleMs > 0) await delay(settleMs);
        await this.pointerUp(to);
    }

    async wheel(deltaY: number, at: Point): Promise<void> {
        await this.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: at.x,
            y: at.y,
            deltaX: 0,
            deltaY,
            button: "none",
            pointerType: "mouse",
        });
    }

    async press(code: KeyCode): Promise<void> {
        const { key, text, vk } = KEYS[code];
        const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
        await this.send("Input.dispatchKeyEvent", { ...base, type: "keyDown", ...(text ? { text } : {}) });
        await this.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    }

    async resize(width: number, height: number): Promise<void> {
        await this.send("Emulation.setDeviceMetricsOverride", {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        });
    }

    async screenshot(label: string): Promise<string | null> {
        try {
            const result = await this.send("Page.captureScreenshot", { format: "png" });
            const data = (result as { data?: string }).data;
            if (!data) return null;
            const path = `tmp/browser/${label.replace(/[^a-zA-Z0-9._-]+/g, "-")}.png`;
            await this.fs.mkdir("tmp/browser", { recursive: true });
            await this.fs.writeFile(path, data, "base64");
            return path;
        } catch {
            return null; // A screenshot is a debugging aid; never fail a test over it.
        }
    }

    async close(): Promise<void> {
        try {
            await this.browser.send("Browser.close");
        } catch {
            // Already gone, or the socket died first: fall through to the kill.
        }
        this.browser.close();
        this.chrome.kill();
        await this.server.close();
        await delay(200); // Let the browser release its profile files.
        try {
            await this.fs.rm(this.profile, { recursive: true, force: true });
        } catch {
            // A leftover temp profile is not worth failing a run over.
        }
    }
}
