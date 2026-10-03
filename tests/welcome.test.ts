import { describe, expect, it } from "vitest";
import { desertEra, grasslandEra, iceAgeEra } from "../src/sim/era";
import { REPRODUCTION_MODES, preselect } from "../src/ui/welcome";
import { asHTMLElement, createMockElement } from "./test-dom-helper";

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
            const welcome = createWelcome(asHTMLElement(container), () => { startCalls++; }, ERAS);

            // 1. Initial show (first load)
            welcome.show();
            expect(welcome.isOpen()).toBe(true);
            const closeBtn = container.querySelector("#welcome-close");
            const cancelBtn = container.querySelector("#welcome-cancel");
            expect(closeBtn?.hidden).toBe(true);
            expect(cancelBtn?.hidden).toBe(true);

            // 2. Reopen from running game
            welcome.show({ era: grasslandEra, reproduction: "asexual" });
            expect(closeBtn?.hidden).toBe(false);
            expect(cancelBtn?.hidden).toBe(false);

            // 3. Cancel via close button
            closeBtn?.click();
            expect(welcome.isOpen()).toBe(false);
            expect(startCalls).toBe(0);

            // 4. Cancel via Escape key
            welcome.show({ era: grasslandEra, reproduction: "asexual" });
            expect(welcome.isOpen()).toBe(true);
            for (const fn of windowListeners["keydown"] || []) {
                fn({
                    key: "Escape",
                    preventDefault: () => {
                        // Mock event preventDefault in test environment
                    },
                });
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
