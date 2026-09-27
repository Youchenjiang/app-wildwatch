import { describe, expect, it } from "vitest";
import { desertEra, grasslandEra, iceAgeEra } from "../src/sim/era";
import { atmosphereColorsForEra, defaultAtmosphereColors } from "../src/render/scene";

describe("era atmosphere", () => {
    it("keeps the lights bright even when the era sky is a near-black void", () => {
        const calculateLuminance = (rgb: { r: number; g: number; b: number }) => rgb.r + rgb.g + rgb.b;
        for (const era of [grasslandEra, iceAgeEra, desertEra]) {
            const colors = atmosphereColorsForEra(era);
            // A dark sky must never become a black sun, or the world renders at
            // ~10% brightness — the scene is lit almost entirely by these.
            expect(calculateLuminance(colors.sunPeak)).toBeGreaterThan(2.0);
            expect(calculateLuminance(colors.hemiSkyPeak)).toBeGreaterThan(1.8);
            // Ambient colors still come straight from the era palette.
            expect(colors.bgPeak.getHex()).toBe(era.skyColor);
            expect(colors.bgTrough.getHex()).toBe(era.skyTroughColor);
            expect(colors.groundPeak.getHex()).toBe(era.groundColor);
            // The desert must read warm (red > blue) rather than cold.
            if (era.name === "Desert") expect(colors.sunPeak.r).toBeGreaterThan(colors.sunPeak.b);
        }
    });

    it("makes the grassland era match the neutral baseline look", () => {
        const colors = atmosphereColorsForEra(grasslandEra);
        const defaults = defaultAtmosphereColors();
        expect(colors.bgPeak.getHex()).toBe(defaults.bgPeak.getHex());
        expect(colors.groundPeak.getHex()).toBe(defaults.groundPeak.getHex());
        const calculateLuminance = (rgb: { r: number; g: number; b: number }) => rgb.r + rgb.g + rgb.b;
        expect(Math.abs(calculateLuminance(colors.sunPeak) - calculateLuminance(defaults.sunPeak))).toBeLessThan(0.5);
    });
});
