import { describe, expect, it } from "vitest";
import { depthScale, gameOverVeil, kinStatText, updateStateBanner } from "../src/ui/hud";
import type { TurnRecord } from "../src/sim/world";

const depthRecord = (livingMaxDepth: number): TurnRecord => ({ livingMaxDepth }) as TurnRecord;

describe("lineage chart scale", () => {
    it("spans the deepest reading in the window", () => {
        // Both depth lines share this, so the mean reads against the deepest
        // rather than each filling the chart on its own.
        expect(depthScale([depthRecord(3), depthRecord(41), depthRecord(12)])).toBe(41);
    });

    it("never returns zero, which would divide the chart by nothing", () => {
        expect(depthScale([])).toBe(1);
        expect(depthScale([depthRecord(0), depthRecord(0)])).toBe(1);
    });
});

describe("game-over veil", () => {
    it("stays hidden while the run is alive", () => {
        // The regression this guards: the veil used to be shown when a run
        // ended and never taken down, so pressing R to start over left the old
        // run's numbers covering the middle of the screen for good.
        const veil = gameOverVeil(null, 929, 92981);
        expect(veil.hidden).toBe(true);
        expect(veil.title).toBe("");
        expect(veil.sub).toBe("");
    });

    it("names the species that died out and the run it ended", () => {
        const herb = gameOverVeil("herbivore", 929, 92981);
        expect(herb.hidden).toBe(false);
        expect(herb.title).toBe("草食族群滅絕");
        expect(herb.sub).toContain("回合 929");
        expect(herb.sub).toContain("92981 ticks");

        expect(gameOverVeil("carnivore", 12, 340).title).toBe("肉食族群滅絕");
    });

    it("updates and clears DOM elements on state transitions and restarts", () => {
        const stateEl = { textContent: "", className: "" } as unknown as Element;
        const overEl = { hidden: false, style: { display: "" } } as unknown as HTMLElement;
        const overTitleEl = { textContent: "" } as unknown as Element;
        const overSubEl = { innerHTML: "" } as unknown as Element;

        // 1. Live run
        updateStateBanner({ gameOver: null, turn: 10, tick: 500 }, false, stateEl, overEl, overTitleEl, overSubEl);
        expect(overEl.hidden).toBe(true);
        expect(overEl.style.display).toBe("none");
        expect(stateEl.textContent).toBe("運行中");

        // 2. Extinction (Game over)
        updateStateBanner({ gameOver: "herbivore", turn: 15, tick: 800 }, false, stateEl, overEl, overTitleEl, overSubEl);
        expect(overEl.hidden).toBe(false);
        expect(overEl.style.display).toBe("");
        expect(stateEl.textContent).toBe("訓練結束");
        expect(overTitleEl.textContent).toBe("草食族群滅絕");
        expect(overSubEl.innerHTML).toContain("回合 15");

        // 3. Restart (World is reseeded)
        updateStateBanner({ gameOver: null, turn: 0, tick: 0 }, false, stateEl, overEl, overTitleEl, overSubEl);
        expect(overEl.hidden).toBe(true);
        expect(overEl.style.display).toBe("none");
        expect(overTitleEl.textContent).toBe("");
        expect(overSubEl.innerHTML).toBe("");
        expect(stateEl.textContent).toBe("運行中");
    });
});

describe("kin feeding stat", () => {
    it("shows a dash before any corpse has been eaten", () => {
        expect(kinStatText(0, 0)).toBe("近親取食 —");
    });

    it("reports kin as a share of all corpse meals", () => {
        expect(kinStatText(4, 1)).toBe("近親取食 1 · 佔腐食 25%");
        expect(kinStatText(3, 0)).toBe("近親取食 0 · 佔腐食 0%");
        expect(kinStatText(3, 3)).toBe("近親取食 3 · 佔腐食 100%");
    });

    it("names the direction only when the split accounts for the total", () => {
        // Both sides given and they add up: say which way it ran.
        expect(kinStatText(4, 1, 1, 0)).toBe("近親取食 1 · 佔腐食 25%（全為親代）");
        expect(kinStatText(8, 3, 1, 2)).toBe("近親取食 3 · 佔腐食 38%（親代 1 · 子代 2）");
        // A split that does not add up is not a breakdown of anything, so the
        // stat stays silent about direction rather than guessing.
        expect(kinStatText(4, 3, 1, 0)).toBe("近親取食 3 · 佔腐食 75%");
        // ...and the same when there are no kin meals to break down at all.
        expect(kinStatText(3, 0, 0, 0)).toBe("近親取食 0 · 佔腐食 0%");
    });
});
