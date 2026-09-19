/** Probe: does a hand-built food-chasing brain beat the evolved circlers? */
import { describe, expect, it } from "vitest";
import { Brain } from "../src/sim/brain";
import { makeSeeding } from "../src/sim/seeding";
import { World } from "../src/sim/world";

/**
 * Chaser genome: hidden[0] = foodRight, hidden[1] = foodFwd + bias.
 * steer = 8 * foodRight (turn toward the side the food is on),
 * thrust = 3 * (foodFwd + 0.2) (speed up when food is ahead).
 * Carnivores also weigh carrion direction (inputs 7/8).
 */
function chaserBrain(kind: "herbivore" | "carnivore"): Brain {
    const spec = { inputSize: 11, hiddenSize: 5, outputSize: 2 };
    const w1 = new Float32Array(55);
    const b1 = new Float32Array(5);
    const w2 = new Float32Array(10);
    const b2 = new Float32Array(2);
    w1[0 * 11 + 0] = 1; // h0 <- foodRight
    w1[1 * 11 + 1] = 1; // h1 <- foodFwd
    b1[1] = 0.2;
    if (kind === "carnivore") {
        w1[0 * 11 + 7] = 0.5; // h0 <- carrionRight
        w1[1 * 11 + 8] = 0.5; // h1 <- carrionFwd
    }
    w2[0 * 5 + 0] = 8; // steer <- 8 * h0
    w2[1 * 5 + 1] = 3; // thrust <- 3 * h1
    return new Brain(spec, w1, b1, w2, b2);
}

function normAngle(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

function runWorld(seed: number, ticks: number, chasers: boolean): string {
    const overrides = chasers ? { mutationRate: 0, mutationSigma: 0 } : {};
    const world = new World({ ...makeSeeding(seed), ...overrides });
    if (chasers) {
        for (const e of world.entities) {
            e.brain = chaserBrain(e.species.kind);
        }
    }
    const lastAngle = new Map<number, number>();
    let totalTurn = 0;
    let turnSamples = 0;
    let peakHerb = 0;
    let peakCarn = 0;
    for (let i = 1; i <= ticks; i++) {
        world.tickStep();
        if (i % 20 === 0) {
            for (const e of world.entities) {
                if (!e.alive) continue;
                const prev = lastAngle.get(e.id);
                if (prev !== undefined) {
                    totalTurn += Math.abs(normAngle(e.angle - prev));
                    turnSamples++;
                }
                lastAngle.set(e.id, e.angle);
            }
            peakHerb = Math.max(peakHerb, world.populationOf("herbivore"));
            peakCarn = Math.max(peakCarn, world.populationOf("carnivore"));
        }
        if (world.gameOver !== null) {
            return `DIED tick ${i} (${world.gameOver}) peak h=${peakHerb} c=${peakCarn} turn=${(totalTurn / Math.max(1, turnSamples)).toFixed(3)}`;
        }
    }
    const herb = world.populationOf("herbivore");
    const carn = world.populationOf("carnivore");
    const avgFit =
        world.entities.reduce((s, e) => s + e.fitness, 0) / Math.max(1, world.entities.length);
    return `ALIVE h=${herb} c=${carn} peak h=${peakHerb} c=${peakCarn} avgFit=${avgFit.toFixed(0)} turn=${(totalTurn / Math.max(1, turnSamples)).toFixed(3)} rad/sample`;
}

describe("chaser vs evolved probe", () => {
    it("compares evolved population against hand-built chasers", () => {
        const ticks = 6000;
        const lines: string[] = [];
        for (const seed of [20260907, 7]) {
            lines.push(`seed=${seed} evolved : ${runWorld(seed, ticks, false)}`);
            lines.push(`seed=${seed} chasers : ${runWorld(seed, ticks, true)}`);
        }
        console.log(`[probe]\n${lines.join("\n")}`);
        // Informational probe: it documents the dominant strategy; no hard
        // assertion so ecology drift does not break CI. Re-read the log after
        // any mechanic change.
        expect(lines).toHaveLength(4);
    }, 120000);
});
