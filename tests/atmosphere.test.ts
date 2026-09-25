import { describe, expect, it } from "vitest";
import { desertEra, grasslandEra, iceAgeEra } from "../src/sim/era";
import { atmosphereColorsForEra, defaultAtmosphereColors } from "../src/render/scene";

describe("era atmosphere", () => {
    it("keeps the lights bright even when the era sky is a near-black void", () => {
        const lum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
        for (const era of [grasslandEra, iceAgeEra, desertEra]) {
            const c = atmosphereColorsForEra(era);
            // A dark sky must never become a black sun, or the world renders at
            // ~10% brightness — the scene is lit almost entirely by these.
            expect(lum(c.sunPeak)).toBeGreaterThan(2.0);
            expect(lum(c.hemiSkyPeak)).toBeGreaterThan(1.8);
            // Ambient colors still come straight from the era palette.
            expect(c.bgPeak.getHex()).toBe(era.skyColor);
            expect(c.bgTrough.getHex()).toBe(era.skyTroughColor);
            expect(c.groundPeak.getHex()).toBe(era.groundColor);
            // The desert must read warm (red > blue) rather than cold.
            if (era.name === "Desert") expect(c.sunPeak.r).toBeGreaterThan(c.sunPeak.b);
        }
    });

    it("makes the grassland era match the neutral baseline look", () => {
        const c = atmosphereColorsForEra(grasslandEra);
        const d = defaultAtmosphereColors();
        expect(c.bgPeak.getHex()).toBe(d.bgPeak.getHex());
        expect(c.groundPeak.getHex()).toBe(d.groundPeak.getHex());
        const lum = (x: { r: number; g: number; b: number }) => x.r + x.g + x.b;
        expect(Math.abs(lum(c.sunPeak) - lum(d.sunPeak))).toBeLessThan(0.5);
    });
});
