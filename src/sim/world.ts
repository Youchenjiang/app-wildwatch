import { Brain, type BrainSpec } from "./brain";
import { Entity } from "./entity";
import { mulberry32, randRange, type RNG } from "./rng";
import { SpatialGrid } from "./spatial-grid";
import { SPECIES } from "./species";
import type { SpeciesKind, SpeciesParams, Vec2 } from "./types";

export const DEFAULT_BRAIN_SPEC: BrainSpec = {
    inputSize: 6,
    hiddenSize: 5,
    outputSize: 2,
};

export interface Plant {
    id: number;
    x: number;
    y: number;
    energy: number;
    alive: boolean;
}

/** Per-turn population statistics — the raw material for evolution charts. */
export interface TurnRecord {
    turn: number;
    tick: number;
    populations: Record<SpeciesKind, number>;
    avgEnergy: Record<SpeciesKind, number>;
    avgGeneration: Record<SpeciesKind, number>;
    births: Record<SpeciesKind, number>;
    deaths: Record<SpeciesKind, number>;
    /** Average per-weight stddev across the population (cheap diversity proxy). */
    geneDiversity: Record<SpeciesKind, number>;
    avgFitness: Record<SpeciesKind, number>;
    maxFitness: Record<SpeciesKind, number>;
}

export interface WorldConfig {
    width: number;
    height: number;
    seed: number;
    herbivoreCount: number;
    carnivoreCount: number;
    plantCount: number;
    plantRegrowPerTick: number;
    plantEnergy: number;
    maxPlants: number;
    /** Simulation ticks between snapshots. One "turn" = one snapshot. */
    turnLength: number;
    populationCap: number;
    mutationRate: number;
    mutationSigma: number;
    brainSpec: BrainSpec;
}

interface Sense {
    dx: number;
    dy: number;
    dist: number;
}

const EMPTY_COUNTS = (): Record<SpeciesKind, number> => ({ herbivore: 0, carnivore: 0 });
const KINDS: readonly SpeciesKind[] = ["herbivore", "carnivore"];

export class World {
    config: WorldConfig;
    rng: RNG;
    entities: Entity[] = [];
    plants: Plant[] = [];
    records: TurnRecord[] = [];

    tick = 0;
    turn = 0;

    private readonly grid = new SpatialGrid<Entity>(10);
    private readonly plantGrid = new SpatialGrid<Plant>(10);
    private nextId = 1;
    private births: Record<SpeciesKind, number> = EMPTY_COUNTS();
    private deaths: Record<SpeciesKind, number> = EMPTY_COUNTS();

    constructor(config: WorldConfig) {
        this.config = config;
        this.rng = mulberry32(config.seed);
        for (let i = 0; i < config.herbivoreCount; i++) {
            this.spawnEntity(SPECIES.herbivore, 0);
        }
        for (let i = 0; i < config.carnivoreCount; i++) {
            this.spawnEntity(SPECIES.carnivore, 0);
        }
        for (let i = 0; i < config.plantCount; i++) {
            this.spawnPlant();
        }
    }

    // ---------------------------------------------------------------------
    // Spawning
    // ---------------------------------------------------------------------

    private randomPos(): { x: number; y: number } {
        return {
            x: randRange(this.rng, 1, this.config.width - 1),
            y: randRange(this.rng, 1, this.config.height - 1),
        };
    }

    private spawnPlant(): void {
        const pos = this.randomPos();
        this.plants.push({
            id: this.nextId++,
            x: pos.x,
            y: pos.y,
            energy: this.config.plantEnergy,
            alive: true,
        });
    }

    private spawnEntity(
        species: SpeciesParams,
        generation: number,
        parent?: Entity,
        childEnergy?: number,
    ): Entity {
        const pos = parent
            ? this.clampPos({
                  x: parent.pos.x + randRange(this.rng, -2, 2),
                  y: parent.pos.y + randRange(this.rng, -2, 2),
              })
            : this.randomPos();
        const brain = parent
            ? (() => {
                  const child = parent.brain.clone();
                  child.mutate(this.config.mutationRate, this.config.mutationSigma, this.rng);
                  return child;
              })()
            : Brain.random(this.config.brainSpec, this.rng);
        const entity = new Entity(
            species,
            pos,
            randRange(this.rng, 0, Math.PI * 2),
            brain,
            this.nextId++,
            childEnergy ?? species.maxEnergy * 0.8,
        );
        entity.generation = generation;
        entity.parentIds = parent ? [parent.id, parent.parentIds ? parent.parentIds[0] : parent.id] : null;
        this.entities.push(entity);
        return entity;
    }

    private clampPos(pos: { x: number; y: number }): { x: number; y: number } {
        const m = 0.5;
        return {
            x: Math.min(Math.max(pos.x, m), this.config.width - m),
            y: Math.min(Math.max(pos.y, m), this.config.height - m),
        };
    }

    // ---------------------------------------------------------------------
    // Main loop
    // ---------------------------------------------------------------------

    /** Advance the simulation by one tick. */
    tickStep(): void {
        this.tick++;

        // Plants regrow at a steady rate (era-dependent rate comes later).
        for (let i = 0; i < this.config.plantRegrowPerTick; i++) {
            if (this.plants.length >= this.config.maxPlants) break;
            this.spawnPlant();
        }

        // Rebuild spatial indexes for this tick.
        this.grid.clear();
        for (const e of this.entities) {
            if (e.alive) this.grid.insert(e.pos.x, e.pos.y, e);
        }
        this.plantGrid.clear();
        for (const p of this.plants) {
            if (p.alive) this.plantGrid.insert(p.x, p.y, p);
        }

        // Update every entity.
        for (const e of this.entities) {
            if (e.alive) this.updateEntity(e);
        }

        // Sweep the dead.
        this.entities = this.entities.filter((e) => e.alive);
        this.plants = this.plants.filter((p) => p.alive);

        // Turn snapshot.
        if (this.tick % this.config.turnLength === 0) {
            this.recordSnapshot();
        }
    }

    private updateEntity(e: Entity): void {
        const s = e.species;
        e.age++;

        const sense = this.sense(e);
        const out = e.brain.forward(this.buildInputs(e, sense));
        const steer = out[0];
        const thrust = (out[1] + 1) / 2;

        e.angle += steer * s.maxTurn;
        const speed = s.speed * (0.2 + 0.8 * thrust);
        e.pos.x += Math.cos(e.angle) * speed;
        e.pos.y += Math.sin(e.angle) * speed;
        const clamped = this.clampPos(e.pos);
        e.pos.x = clamped.x;
        e.pos.y = clamped.y;

        e.energy -= s.moveCost * (0.3 + 0.7 * thrust);

        this.tryEat(e);

        if (e.energy >= s.reproduceEnergy) this.reproduce(e);

        if (e.energy <= 0 || e.age >= s.maxAge) {
            this.kill(e, e.energy <= 0 ? "starvation" : "old age");
        }
    }

    // ---------------------------------------------------------------------
    // Sensing -> brain inputs
    // ---------------------------------------------------------------------

    private queryPlants(at: Vec2, radius: number): Plant[] {
        const found: Plant[] = [];
        this.plantGrid.query(at.x, at.y, radius, found);
        return found;
    }

    private queryEntities(at: Vec2, radius: number): Entity[] {
        const found: Entity[] = [];
        this.grid.query(at.x, at.y, radius, found);
        return found;
    }

    /** Closest candidate that passes `accept`, measured from `from`. */
    private nearest<T>(
        candidates: readonly T[],
        accept: (candidate: T) => boolean,
        pos: (candidate: T) => Vec2,
        from: Vec2,
    ): { item: T; dx: number; dy: number; d2: number } | null {
        let best: { item: T; dx: number; dy: number; d2: number } | null = null;
        let bestD2 = Infinity;
        for (const candidate of candidates) {
            if (!accept(candidate)) continue;
            const at = pos(candidate);
            const dx = at.x - from.x;
            const dy = at.y - from.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = { item: candidate, dx, dy, d2 };
            }
        }
        return best;
    }

    private sense(e: Entity): Sense | null {
        const s = e.species;
        const found =
            s.kind === "herbivore"
                ? this.nearest(this.queryPlants(e.pos, s.senseRange), (p) => p.alive, (p) => p, e.pos)
                : this.nearest(
                      this.queryEntities(e.pos, s.senseRange),
                      (p) => p.alive && p.species.kind === "herbivore",
                      (p) => p.pos,
                      e.pos,
                  );
        return found ? { dx: found.dx, dy: found.dy, dist: Math.sqrt(found.d2) } : null;
    }

    private buildInputs(e: Entity, sense: Sense | null): number[] {
        const s = e.species;
        const dist = sense ? Math.min(1, sense.dist / s.senseRange) : 1;
        return [
            Math.sin(e.angle),
            Math.cos(e.angle),
            sense ? sense.dx / s.senseRange : 0,
            sense ? sense.dy / s.senseRange : 0,
            dist,
            Math.min(1, e.energy / s.maxEnergy),
        ];
    }

    // ---------------------------------------------------------------------
    // Eating / reproduction / death
    // ---------------------------------------------------------------------

    private tryEat(e: Entity): void {
        const s = e.species;
        if (s.kind === "herbivore") {
            const found = this.nearest(
                this.queryPlants(e.pos, s.eatRadius),
                (p) => p.alive,
                (p) => p,
                e.pos,
            );
            if (found) {
                found.item.alive = false;
                e.energy += found.item.energy;
                e.fitness += found.item.energy;
                e.foodEaten++;
            }
            return;
        }
        const found = this.nearest(
            this.queryEntities(e.pos, s.eatRadius),
            (p) => p.alive && p.species.kind === "herbivore",
            (p) => p.pos,
            e.pos,
        );
        if (found) {
            const meat = found.item.energy;
            this.kill(found.item, "preyed");
            const gained = meat * 0.6 + s.foodEnergy;
            e.energy += gained;
            e.fitness += gained;
            e.foodEaten++;
        }
    }

    private reproduce(e: Entity): void {
        const s = e.species;
        let alive = 0;
        for (const other of this.entities) {
            if (other.alive && other.species.kind === s.kind) alive++;
        }
        if (alive >= this.config.populationCap) return;

        const childEnergy = s.reproduceCost / s.litterSize;
        for (let i = 0; i < s.litterSize; i++) {
            this.spawnEntity(s, e.generation + 1, e, childEnergy);
        }
        e.energy -= s.reproduceCost;
        this.births[s.kind] += s.litterSize;
    }

    private kill(e: Entity, _reason: string): void {
        if (!e.alive) return;
        e.alive = false;
        this.deaths[e.species.kind]++;
    }

    // ---------------------------------------------------------------------
    // Records & stats
    // ---------------------------------------------------------------------

    private geneDiversity(kind: SpeciesKind): number {
        const pop = this.entities.filter((e) => e.alive && e.species.kind === kind);
        if (pop.length < 2) return 0;
        const k = Math.min(12, pop[0].brain.w1.length);
        let acc = 0;
        for (let wi = 0; wi < k; wi++) {
            let mean = 0;
            for (const e of pop) mean += e.brain.w1[wi];
            mean /= pop.length;
            let variance = 0;
            for (const e of pop) {
                const d = e.brain.w1[wi] - mean;
                variance += d * d;
            }
            acc += Math.sqrt(variance / pop.length);
        }
        return acc / k;
    }

    private recordSnapshot(): void {
        const record: TurnRecord = {
            turn: this.turn,
            tick: this.tick,
            populations: EMPTY_COUNTS(),
            avgEnergy: EMPTY_COUNTS(),
            avgGeneration: EMPTY_COUNTS(),
            births: { ...this.births },
            deaths: { ...this.deaths },
            geneDiversity: EMPTY_COUNTS(),
            avgFitness: EMPTY_COUNTS(),
            maxFitness: EMPTY_COUNTS(),
        };
        for (const kind of KINDS) {
            const pop = this.entities.filter((e) => e.alive && e.species.kind === kind);
            record.populations[kind] = pop.length;
            record.avgEnergy[kind] = pop.length
                ? pop.reduce((sum, e) => sum + e.energy, 0) / pop.length
                : 0;
            record.avgGeneration[kind] = pop.length
                ? pop.reduce((sum, e) => sum + e.generation, 0) / pop.length
                : 0;
            record.geneDiversity[kind] = this.geneDiversity(kind);
            record.avgFitness[kind] = pop.length
                ? pop.reduce((sum, e) => sum + e.fitness, 0) / pop.length
                : 0;
            record.maxFitness[kind] = pop.length
                ? Math.max(...pop.map((e) => e.fitness))
                : 0;
        }
        this.records.push(record);
        this.turn++;
        this.births = EMPTY_COUNTS();
        this.deaths = EMPTY_COUNTS();
    }

    populationOf(kind: SpeciesKind): number {
        let count = 0;
        for (const e of this.entities) {
            if (e.alive && e.species.kind === kind) count++;
        }
        return count;
    }

    avgEnergyOf(kind: SpeciesKind): number {
        let sum = 0;
        let count = 0;
        for (const e of this.entities) {
            if (e.alive && e.species.kind === kind) {
                sum += e.energy;
                count++;
            }
        }
        return count ? sum / count : 0;
    }
}