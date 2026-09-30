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
