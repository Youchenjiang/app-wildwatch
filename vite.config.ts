/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
    },
    preview: {
        host: "127.0.0.1",
        port: 4173,
        strictPort: true,
    },
    test: {
        include: ["tests/**/*.test.ts"],
        environment: "node",
        // The simulation suite runs every test file in parallel across all
        // cores, so CPU-bound world tests stretch well past vitest's 5s
        // default under load. Tests that are known to be slow still opt into
        // their own larger timeouts; this is only the baseline.
        testTimeout: 60_000,
    },
});