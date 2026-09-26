import { seasonAbundanceAt } from "../sim/world";
import type { World } from "../sim/world";

/**
 * Observer-side recorder for replay and slow-motion review.
 *
 * Purely observational (docs/game-rules.md "觀察者工具"): it captures sim
 * state without touching it, so a run's determinism is unaffected. Frames
 * are stored in a ring buffer so memory stays bounded over very long runs.
 */
export interface ReplayFrame {
    tick: number;
    turn: number;
    /** [id, kind(0=herbivore,1=carnivore), x, y, angle, energy01, generation] per entity. */
    entities: number[][];
    /** [id, x, y, energy] per plant. */
    plants: number[][];
    /** [id, x, y, energy] per carrion. */
    carrions: number[][];
    populations: { herbivore: number; carnivore: number; plants: number };
    /** Normalized season position at this tick (0 = trough, 1 = peak); null when seasons are off. */
    seasonAbundance: number | null;
}

export class ReplayRecorder {
    private frames: ReplayFrame[] = [];
    /** Interval between captured frames, in ticks. */
    private readonly stride: number;
    /** Ring buffer capacity in frames. */
    private readonly capacity: number;
    private nextTick = 0;

    constructor(stride = 1, capacity = 3600) {
        this.stride = stride;
        this.capacity = capacity;
    }

    get size(): number {
        return this.frames.length;
    }

    get framesCaptured(): number {
        return this.nextTick;
    }

    /** True when a given tick should be captured (on stride multiples). */
    shouldCapture(tick: number): boolean {
        return tick % this.stride === 0;
    }

    /** Capture a frame from the world without mutating anything it reads. */
    capture(world: World): void {
        const entities = world.entities
            .filter((e) => e.alive)
            .map((e) => [
                e.id,
                e.species.kind === "herbivore" ? 0 : 1,
                round2(e.pos.x),
                round2(e.pos.y),
                round2(e.angle),
                round2(Math.min(1, e.energy / e.species.maxEnergy)),
                e.generation,
            ]);
        const plants = world.plants
            .filter((p) => p.alive)
            .map((p) => [p.id, round2(p.x), round2(p.y), round2(p.energy)]);
        const carrions = world.carrions
            .filter((c) => c.alive)
            .map((c) => [c.id, round2(c.x), round2(c.y), round2(c.energy)]);
        const seasonLength = world.config.plantSeasonLength ?? 0;
        const seasonDepth = world.config.plantSeasonDepth ?? 0.5;
        this.frames.push({
            tick: world.tick,
            turn: world.turn,
            entities,
            plants,
            carrions,
            populations: {
                herbivore: world.populationOf("herbivore"),
                carnivore: world.populationOf("carnivore"),
                plants: plants.length,
            },
            seasonAbundance:
                seasonLength > 0 ? seasonAbundanceAt(world.tick, seasonLength, seasonDepth) : null,
        });
        if (this.frames.length > this.capacity) {
            this.frames.shift();
        }
        this.nextTick++;
    }

    /** The most recent frame, or null when nothing recorded yet. */
    latest(): ReplayFrame | null {
        return this.frames.at(-1) ?? null;
    }

    /** Frame by index (0 = oldest retained), or null when out of range. */
    frameAt(index: number): ReplayFrame | null {
        return index >= 0 && index < this.frames.length ? this.frames[index] : null;
    }

    /** Drop all frames (used when a new World replaces the old one). */
    reset(): void {
        this.frames = [];
        this.nextTick = 0;
    }

    /** Snapshot of what the recorder holds (for tests and debugging). */
    stats(): { frames: number; stride: number; capacity: number } {
        return { frames: this.frames.length, stride: this.stride, capacity: this.capacity };
    }
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}
