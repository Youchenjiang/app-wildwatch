import { Brain, type BrainSpec } from "./brain";
import { Entity } from "./entity";
import { mulberry32, randRange, type RNG } from "./rng";
import { SpatialGrid } from "./spatial-grid";
import { SPECIES } from "./species";
import type { SpeciesKind, SpeciesParams, Vec2 } from "./types";
import { createMemory, type Memory } from "./memory";
import { LifeGrid } from "./learning";

export const DEFAULT_BRAIN_SPEC: BrainSpec = {
    inputSize: 11,
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

/** A dead animal: returns its unconsumed energy to the environment (rule 6). */
export interface Carrion {
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
    /** Alive plants at snapshot time — the resource baseline for charts. */
    plantCount: number;
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
    /** Distance within which a same-species neighbor is eligible as a mate. */
    mateRange: number;
    mutationRate: number;
    mutationSigma: number;
    brainSpec: BrainSpec;
    /** Episodic memory capacity per entity (default 64). */
    memoryCapacity?: number;
    /** Population-level life grid cell size (default 6). */
    lifeGridCellsize?: number;
    /** Life-grid decay factor per turn (default 0.05). */
    lifeGridDecay?: number;
    /** Life-grid per-cell cap (default 20). */
    lifeGridCap?: number;
    /** Energy a corpse loses per tick as it decays (default 0.05). */
    carrionDecayPerTick?: number;
}

interface Sense {
    dx: number;
    dy: number;
    dist: number;
}

/** Chance a carnivore catches prey on contact; below 1 lets prey escape. */
const CATCH_CHANCE = 0.4;
/** Prey density at which hunts reach full saturation. */
const PREY_REFUGE_DENSITY = 0.012;
/** Extra catch-rate multiplier when prey are abundant. */
const SATURATION_BONUS = 1.6;
/** Floor on the catch factor when prey are critically rare (prey refuge). */
const REFUGE_FLOOR = 0.05;

const EMPTY_COUNTS = (): Record<SpeciesKind, number> => ({ herbivore: 0, carnivore: 0 });
const KINDS: readonly SpeciesKind[] = ["herbivore", "carnivore"];
const REPRODUCE_COOLDOWN = 60;

export class World {
    config: WorldConfig;
    rng: RNG;
    entities: Entity[] = [];
    plants: Plant[] = [];
    carrions: Carrion[] = [];
    records: TurnRecord[] = [];

    tick = 0;
    turn = 0;

    private readonly grid = new SpatialGrid<Entity>(10);
    private readonly plantGrid = new SpatialGrid<Plant>(10);
    private readonly carrionGrid = new SpatialGrid<Carrion>(10);
    readonly lifeGrid: LifeGrid;
    private nextId = 1;
    private births: Record<SpeciesKind, number> = EMPTY_COUNTS();
    private deaths: Record<SpeciesKind, number> = EMPTY_COUNTS();
    /** Set once either species has died out; the run is over (rules forbid re-seeding). */
    private gameOverBy: SpeciesKind | null = null;

    constructor(config: WorldConfig) {
        this.config = config;
        this.rng = mulberry32(config.seed);
        const memCap = config.memoryCapacity ?? 64;
        this.lifeGrid = new LifeGrid(
            config.width,
            config.height,
            config.lifeGridCellsize ?? 6,
        );
        for (let i = 0; i < config.herbivoreCount; i++) {
            this.spawnEntity(SPECIES.herbivore, 0, undefined, undefined, undefined, createMemory(memCap));
        }
        for (let i = 0; i < config.carnivoreCount; i++) {
            this.spawnEntity(SPECIES.carnivore, 0, undefined, undefined, undefined, createMemory(memCap));
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
        secondParent?: Entity,
        childEnergy?: number,
        memory?: Memory,
    ): Entity {
        const pos = parent
            ? this.clampPos({
                  x: parent.pos.x + randRange(this.rng, -2, 2),
                  y: parent.pos.y + randRange(this.rng, -2, 2),
              })
            : this.randomPos();
        const brain = parent
            ? (() => {
                  const child = secondParent
                      ? parent.brain.crossover(secondParent.brain, this.rng)
                      : parent.brain.clone();
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
            childEnergy ?? species.reproduceEnergy * 0.5,
            memory ?? createMemory(this.config.memoryCapacity ?? 64),
        );
        entity.generation = generation;
        if (secondParent && parent) {
            entity.parentIds = [parent.id, secondParent.id];
        } else if (parent) {
            entity.parentIds = [parent.id, parent.parentIds ? parent.parentIds[0] : parent.id];
        }
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

    /**
     * Rule 7: reflect an entity's heading off a wall it has crossed, with a
     * little jitter so crowds do not march in lockstep. Without this, animals
     * pin against walls (position clamped, heading unchanged) and pile up at
     * edges and corners.
     */
    private bounceOffWalls(e: Entity): void {
        const m = 0.5;
        let bounced = false;
        if (e.pos.x <= m || e.pos.x >= this.config.width - m) {
            e.angle = Math.PI - e.angle + randRange(this.rng, -0.3, 0.3);
            bounced = true;
        }
        if (e.pos.y <= m || e.pos.y >= this.config.height - m) {
            e.angle = -e.angle + randRange(this.rng, -0.3, 0.3);
            bounced = true;
        }
        const clamped = this.clampPos(e.pos);
        e.pos.x = clamped.x;
        e.pos.y = clamped.y;
        if (bounced) {
            // Step the entity back inward along its new heading so it does
            // not re-trigger the bounce on the next tick.
            e.pos.x += Math.cos(e.angle) * 0.5;
            e.pos.y += Math.sin(e.angle) * 0.5;
            const inner = this.clampPos(e.pos);
            e.pos.x = inner.x;
            e.pos.y = inner.y;
        }
    }

    // ---------------------------------------------------------------------
    // Main loop
    // ---------------------------------------------------------------------

    /** Advance the simulation by one tick. */
    tickStep(): void {
        this.tick++;

        // Plants regrow at a steady rate, capped by world carrying capacity.
        for (let i = 0; i < this.config.plantRegrowPerTick; i++) {
            if (this.plants.length >= this.config.maxPlants) break;
            this.spawnPlant();
        }

        this.rebuildIndexes();

        // Update every entity.
        for (const e of this.entities) {
            if (e.alive) this.updateEntity(e);
        }

        this.recordPopulationDensity();
        this.checkExtinction();
        this.sweepTheDead();
        this.decayCarrion();

        // Turn snapshot.
        if (this.tick % this.config.turnLength === 0) {
            this.recordSnapshot();
        }
    }

    /** Either species dying out ends the run: no re-seeding, ever. */
    private checkExtinction(): void {
        if (this.gameOverBy !== null) return;
        for (const kind of KINDS) {
            if (this.populationOf(kind) === 0) {
                this.gameOverBy = kind;
                break;
            }
        }
    }

    /** Drop the dead entities and plants after a tick. */
    private sweepTheDead(): void {
        this.entities = this.entities.filter((e) => e.alive);
        this.plants = this.plants.filter((p) => p.alive);
    }

    /** Carrion decays naturally; fully decayed corpses vanish (rule 6). */
    private decayCarrion(): void {
        const decay = this.config.carrionDecayPerTick ?? 0.05;
        for (const c of this.carrions) {
            if (c.alive) c.energy -= decay;
            if (c.energy <= 0) c.alive = false;
        }
        this.carrions = this.carrions.filter((c) => c.alive);
    }

    /** Rebuild the spatial indexes for the current tick. */
    private rebuildIndexes(): void {
        this.grid.clear();
        for (const e of this.entities) {
            if (e.alive) this.grid.insert(e.pos.x, e.pos.y, e);
        }
        this.plantGrid.clear();
        for (const p of this.plants) {
            if (p.alive) this.plantGrid.insert(p.x, p.y, p);
        }
        this.carrionGrid.clear();
        for (const c of this.carrions) {
            if (c.alive) this.carrionGrid.insert(c.x, c.y, c);
        }
    }

    /** Light population-level life-grid bookkeeping. */
    private recordPopulationDensity(): void {
        if (this.tick % 4 !== 0) return;
        for (const e of this.entities) {
            if (e.alive) this.lifeGrid.record(e.pos.x, e.pos.y, 0.25);
        }
    }

    private updateEntity(e: Entity): void {
        const s = e.species;
        e.age++;
        if (e.reproduceCooldown > 0) e.reproduceCooldown--;

        const sense = this.sense(e);
        const inputs = this.buildInputs(e, sense);

        // Bias behavior with episodic recall before the brain acts.
        const out = this.brainForwardWithRecall(e, inputs);
        const steer = out[0];
        const thrust = (out[1] + 1) / 2;

        const steerMag = Math.abs(steer);
        e.angle += steer * s.maxTurn;
        const speed = s.speed * (0.2 + 0.8 * thrust);
        e.pos.x += Math.cos(e.angle) * speed;
        e.pos.y += Math.sin(e.angle) * speed;
        // Closed world: hitting a boundary is a physical bounce (rule 7),
        // so animals slide off walls instead of pinning against them.
        this.bounceOffWalls(e);

        // Turning is biomechanically expensive: sharp sustained steering
        // (spiraling) burns energy far faster than purposeful travel.
        const turnPenalty = 1 + s.turnCost * steerMag * steerMag * (0.3 + 0.7 * thrust);
        e.energy -= s.moveCost * (0.3 + 0.7 * thrust) * turnPenalty;

        this.tryEat(e, inputs);

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

    private queryCarrion(at: Vec2, radius: number): Carrion[] {
        const found: Carrion[] = [];
        this.carrionGrid.query(at.x, at.y, radius, found);
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

    /** Nearest live carnivore within sense range (herbivore threat sense). */
    private nearestThreat(e: Entity): { dx: number; dy: number; d2: number } | null {
        const s = e.species;
        const found = this.nearest(
            this.queryEntities(e.pos, s.senseRange),
            (other) => other.alive && other.species.kind === "carnivore",
            (other) => other.pos,
            e.pos,
        );
        return found ? { dx: found.dx, dy: found.dy, d2: found.d2 } : null;
    }

    /** Nearest live carrion within sense range (carnivore scavenging sense). */
    private nearestCarrion(e: Entity): { dx: number; dy: number; d2: number } | null {
        const s = e.species;
        const found = this.nearest(
            this.queryCarrion(e.pos, s.senseRange),
            (c) => c.alive,
            (c) => c,
            e.pos,
        );
        return found ? { dx: found.dx, dy: found.dy, d2: found.d2 } : null;
    }

    /**
     * Rule 8: target directions are encoded in the animal's own frame
     * (right/forward components) so "steer toward food" is a linear
     * function of the inputs. The old world-frame (dx, dy) encoding required
     * brains to learn a rotation internally, which evolution never solved —
     * the population converged on constant-curvature circling instead.
     */
    private buildInputs(e: Entity, sense: Sense | null): number[] {
        const s = e.species;
        const range = s.senseRange;
        const cosA = Math.cos(e.angle);
        const sinA = Math.sin(e.angle);
        const toLocal = (dx: number, dy: number): [number, number] => [
            (-dx * sinA + dy * cosA) / range, // right component
            (dx * cosA + dy * sinA) / range, // forward component
        ];

        const [foodRight, foodFwd] = sense ? toLocal(sense.dx, sense.dy) : [0, 0];
        const foodDist = sense ? Math.min(1, sense.dist / range) : 1;

        // Herbivores sense the nearest carnivore so they can evolve flight;
        // carnivores sense the nearest carrion so they can evolve scavenging.
        const isHerbivore = s.kind === "herbivore";
        const threat = isHerbivore ? this.nearestThreat(e) : null;
        const carrion = isHerbivore ? null : this.nearestCarrion(e);

        const [threatRight, threatFwd] = threat ? toLocal(threat.dx, threat.dy) : [0, 0];
        const threatDist = threat ? Math.min(1, Math.sqrt(threat.d2) / range) : 1;
        const [carrionRight, carrionFwd] = carrion ? toLocal(carrion.dx, carrion.dy) : [0, 0];
        const carrionDist = carrion ? Math.min(1, Math.sqrt(carrion.d2) / range) : 1;

        // Input 10 (recallHint) is filled by brainForwardWithRecall; it is 0
        // without a strong episodic match.
        return [
            foodRight,
            foodFwd,
            foodDist,
            Math.min(1, e.energy / s.maxEnergy),
            threatRight,
            threatFwd,
            threatDist,
            carrionRight,
            carrionFwd,
            carrionDist,
            0,
        ];
    }

    /**
     * Forward the brain with a small episodic-recall hint on its own input
     * slot. The hint must never touch the sensory inputs: it used to be
     * blended into input 0, which is now the food-direction signal, and
     * corrupted steering.
     */
    private brainForwardWithRecall(e: Entity, inputs: readonly number[]): Float32Array {
        const best = e.memory.recall(inputs, 1)[0];
        if (best && best.similarity > 0.5) {
            const hint = Array.from(inputs);
            hint[10] = best.episode.actionHint * 0.3 * (1 - best.similarity);
            return e.brain.forward(hint);
        }
        return e.brain.forward(inputs);
    }

    // ---------------------------------------------------------------------
    // Eating / reproduction / death
    // ---------------------------------------------------------------------

    private tryEat(e: Entity, inputs: number[]): void {
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
                e.memory.record(inputs, 0, found.item.energy, e.age);
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
            // Type-III functional response with a hard prey refuge: when
            // prey are rare, hunts almost always fail, so predators starve
            // back before they can finish the prey off. When prey are
            // abundant, hunts saturate and predators can boom.
            const preyDensity =
                this.populationOf("herbivore") / (this.config.width * this.config.height);
            const scarcity = Math.min(1, preyDensity / PREY_REFUGE_DENSITY);
            const factor = scarcity * scarcity * scarcity * SATURATION_BONUS + REFUGE_FLOOR;
            if (this.rng() < CATCH_CHANCE * factor) {
                const meat = found.item.energy;
                this.kill(found.item, "preyed");
                const gained = Math.min(meat * 0.6, s.maxEnergy * 0.5) + s.foodEnergy;
                e.energy += gained;
                e.fitness += gained;
                e.foodEaten++;
                e.memory.record(inputs, 0, gained, e.age);
            }
        }
        // Scavenging: carrion is free energy with no hunt risk (rule 6).
        const corpses: Carrion[] = [];
        this.carrionGrid.query(e.pos.x, e.pos.y, s.eatRadius, corpses);
        for (const c of corpses) {
            if (!c.alive) continue;
            const gained = c.energy;
            c.alive = false;
            e.energy = Math.min(s.maxEnergy, e.energy + gained);
            e.fitness += gained;
            e.foodEaten++;
            e.memory.record(inputs, 0, gained, e.age);
            break;
        }
    }

    private reproduce(e: Entity): void {
        const s = e.species;
        let alive = 0;
        for (const other of this.entities) {
            if (other.alive && other.species.kind === s.kind) alive++;
        }
        if (alive >= this.config.populationCap) return;

        // Prefer sexual reproduction with a nearby eligible mate; fall back
        // to asexual cloning so lone survivors can still propagate.
        const mate = this.findMate(e);
        // Newborns start well below the breeding threshold: they must eat
        // before they can reproduce, which tempers exponential booms.
        const childEnergy = s.reproduceEnergy * 0.25;
        const generation = mate
            ? Math.max(e.generation, mate.generation) + 1
            : e.generation + 1;
        for (let i = 0; i < s.litterSize; i++) {
            this.spawnEntity(s, generation, e, mate ?? undefined, childEnergy);
        }
        if (mate) {
            e.energy -= s.reproduceCost / 2;
            mate.energy -= s.reproduceCost / 2;
            mate.reproduceCooldown = REPRODUCE_COOLDOWN;
        } else {
            e.energy -= s.reproduceCost;
        }
        e.reproduceCooldown = REPRODUCE_COOLDOWN;
        this.births[s.kind] += s.litterSize;
    }

    private findMate(e: Entity): Entity | null {
        const candidates: Entity[] = [];
        this.grid.query(e.pos.x, e.pos.y, this.config.mateRange, candidates);
        let best: Entity | null = null;
        let bestD2 = Infinity;
        for (const other of candidates) {
            if (
                other === e ||
                !other.alive ||
                other.species.kind !== e.species.kind ||
                other.energy < other.species.reproduceEnergy ||
                other.reproduceCooldown > 0
            ) {
                continue;
            }
            const dx = other.pos.x - e.pos.x;
            const dy = other.pos.y - e.pos.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
                bestD2 = d2;
                best = other;
            }
        }
        return best;
    }

    private kill(e: Entity, _reason: string): void {
        if (!e.alive) return;
        e.alive = false;
        this.deaths[e.species.kind]++;
        // The body stays behind with its remaining energy (rule 6: carrion).
        if (e.energy > 0) {
            this.carrions.push({
                id: this.nextId++,
                x: e.pos.x,
                y: e.pos.y,
                energy: e.energy,
                alive: true,
            });
        }
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
            plantCount: 0,
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
        record.plantCount = this.plants.filter((p) => p.alive).length;
        this.records.push(record);
        this.turn++;
        this.lifeGrid.decay(
            this.config.lifeGridDecay ?? 0.05,
            this.config.lifeGridCap ?? 20,
        );
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

    /** The species whose extinction ended the run, or null while it continues. */
    get gameOver(): SpeciesKind | null {
        return this.gameOverBy;
    }

    /**
     * Observer tool (docs/game-rules.md "觀察者工具"): end the run early.
     * Purely observational from the sim's perspective — it stops the loop;
     * it never edits entity state.
     */
    terminate(): void {
        if (this.gameOverBy !== null) return;
        const herb = this.populationOf("herbivore");
        const carn = this.populationOf("carnivore");
        if (herb === 0) {
            this.gameOverBy = "herbivore";
        } else if (carn === 0) {
            this.gameOverBy = "carnivore";
        } else {
            this.gameOverBy = herb <= carn ? "herbivore" : "carnivore";
        }
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