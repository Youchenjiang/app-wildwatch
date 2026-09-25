import { describe, expect, it } from "vitest";
import { gameOverVeil, kinStatText } from "../src/ui/hud";

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
