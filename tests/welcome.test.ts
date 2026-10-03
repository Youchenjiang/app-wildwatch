import { describe, expect, it } from "vitest";
import { desertEra, grasslandEra, iceAgeEra } from "../src/sim/era";
import { REPRODUCTION_MODES, preselect } from "../src/ui/welcome";

const ERAS = [grasslandEra, iceAgeEra, desertEra];

describe("welcome picker preselect", () => {
    it("opens on the first era and the default mode with nothing running", () => {
        const pick = preselect(ERAS);
        expect(pick.era).toBe(grasslandEra);
        expect(pick.mode).toBe("asexual");
    });

    it("opens on the settings the run is actually using", () => {
        // The point of reopening the picker: it shows what is in force, so a
        // player changing one thing does not silently change the other.
        const pick = preselect(ERAS, { era: desertEra, reproduction: "sexual" });
        expect(pick.era).toBe(desertEra);
        expect(pick.mode).toBe("sexual");
    });

    it("falls back to the first era when the run has no era to name", () => {
        // The module-level world is seeded with no era, and there is no card
        // for "none", so the picker must still open with something selected.
        expect(preselect(ERAS, { era: undefined }).era).toBe(grasslandEra);
    });

    it("falls back when the running era is no longer offered", () => {
        const retired = { ...iceAgeEra, name: "Tundra" };
        expect(preselect(ERAS, { era: retired }).era).toBe(grasslandEra);
    });

    it("falls back to the default mode for a mode that no longer exists", () => {
        // The mixed mode was removed from the list; a stale value reaching the
        // picker must not leave every card unselected.
        const stale = { era: grasslandEra, reproduction: "mixed" as "asexual" };
        expect(preselect(ERAS, stale).mode).toBe(REPRODUCTION_MODES[0].mode);
    });

    it("offers exactly the modes the simulation supports, default first", () => {
        expect(REPRODUCTION_MODES.map((modeItem) => modeItem.mode)).toEqual(["asexual", "sexual"]);
    });
});

function createMockElement(tag = "div"): any {
    const listeners: Record<string, Function[]> = {};
    const classes = new Set<string>();
    const children: any[] = [];
    const elementsById: Record<string, any> = {};

    const el: any = {
        tagName: tag.toUpperCase(),
        id: "",
        className: "",
        textContent: "",
        innerHTML: "",
        hidden: false,
        children,
        classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            toggle: (c: string, force?: boolean) => {
                if (force === undefined) {
                    if (classes.has(c)) classes.delete(c);
                    else classes.add(c);
                } else if (force) {
                    classes.add(c);
                } else {
                    classes.delete(c);
                }
                return classes.has(c);
            },
            contains: (c: string) => classes.has(c),
        },
        appendChild(child: any) {
            children.push(child);
            return child;
        },
        addEventListener(event: string, fn: Function) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        dispatchEvent(evt: any) {
            for (const fn of listeners[evt.type] || []) fn(evt);
        },
        click() {
            this.dispatchEvent({ type: "click" });
        },
        querySelector(selector: string) {
            const idMatch = selector.match(/#([\w-]+)/);
            if (idMatch) {
                const targetId = idMatch[1];
                if (el.id === targetId) return el;
                for (const child of children) {
                    const found = child.querySelector(selector);
                    if (found) return found;
                }
                if (!elementsById[targetId]) {
                    const sub = createMockElement();
                    sub.id = targetId;
                    elementsById[targetId] = sub;
                }
                return elementsById[targetId];
            }
            return null;
        },
        querySelectorAll() {
            return [];
        },
    };
    return el;
}

describe("welcome close and cancel controls", () => {
    it("hides cancel buttons on initial open and shows them on reopen", async () => {
        const origDoc = globalThis.document;
        const windowListeners: Record<string, Function[]> = {};
        const origAdd = globalThis.window?.addEventListener;
        const origRemove = globalThis.window?.removeEventListener;

        globalThis.document = {
            createElement: (tag: string) => createMockElement(tag),
        } as unknown as Document;

        globalThis.window = {
            addEventListener: (ev: string, fn: Function) => {
                windowListeners[ev] = windowListeners[ev] || [];
                windowListeners[ev].push(fn);
            },
            removeEventListener: (ev: string, fn: Function) => {
                if (windowListeners[ev]) {
                    windowListeners[ev] = windowListeners[ev].filter((f) => f !== fn);
                }
            },
        } as unknown as Window & typeof globalThis;

        try {
            const { createWelcome } = await import("../src/ui/welcome");
            const container = createMockElement("div");
            let startCalls = 0;
            const welcome = createWelcome(container, () => { startCalls++; }, ERAS);

            // 1. Initial show (first load)
            welcome.show();
            expect(welcome.isOpen()).toBe(true);
            const closeBtn = container.querySelector("#welcome-close");
            const cancelBtn = container.querySelector("#welcome-cancel");
            expect(closeBtn.hidden).toBe(true);
            expect(cancelBtn.hidden).toBe(true);

            // 2. Reopen from running game
            welcome.show({ era: grasslandEra, reproduction: "asexual" });
            expect(closeBtn.hidden).toBe(false);
            expect(cancelBtn.hidden).toBe(false);

            // 3. Cancel via close button
            closeBtn.click();
            expect(welcome.isOpen()).toBe(false);
            expect(startCalls).toBe(0);

            // 4. Cancel via Escape key
            welcome.show({ era: grasslandEra, reproduction: "asexual" });
            expect(welcome.isOpen()).toBe(true);
            for (const fn of windowListeners["keydown"] || []) {
                fn({ key: "Escape", preventDefault: () => {} });
            }
            expect(welcome.isOpen()).toBe(false);
            expect(startCalls).toBe(0);
        } finally {
            globalThis.document = origDoc;
            if (origAdd) globalThis.window.addEventListener = origAdd;
            if (origRemove) globalThis.window.removeEventListener = origRemove;
        }
    });
});
