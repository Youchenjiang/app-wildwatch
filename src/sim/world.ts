import { Brain, type BrainSpec } from "./brain";
import { Entity } from "./entity";
import { mulberry32, pick, randRange, type RNG } from "./rng";
import { SpatialGrid } from "./spatial-grid";
import { SPECIES } from "./species";
import type { SpeciesKind, SpeciesParams, Vec2 } from "./types";
import { createMemory, type Memory } from "./memory";
import { createMealLog } from "./meals";
import { createLineage } from "./lineage";
import { LifeGrid } from "./learning";
import { overlaySpecies, overlayPlants } from "./era";

export const DEFAULT_BRAIN_SPEC: BrainSpec = {
    inputSize: 11,
    hiddenSize: 5,
    outputSize: 2,
};

/**
 * A plant stands still from the moment it grows.
 *
 * `x` and `y` are readonly because the spatial index files a plant once, when
 * it appears, and never re-checks it — there is nothing about a plant that can
 * go stale. Anything that moved a plant after it was filed would vanish from
 * the index's point of view while still standing in the world, and grazing
 * would quietly stop finding it. The type is what stops that silently
 * happening rather than a comment asking nicely.
 *
 * `energy` and `bites` do change under a plant's feet as it is grazed, which is
 * fine for the same reason: the index files a plant by where it stands, not by
 * how much of it is left.
 */
export interface Plant {
    id: number;
    readonly x: number;
    readonly y: number;
    /**
     * Energy still standing in this tuft: one bite takes a share of it and
     * leaves the rest, so this is a remainder rather than a constant. It is
     * `bites × biteEnergy` at all times.
     */
    energy: number;
    /**
     * Bites still available. Kept as a count rather than derived from the
     * energy because it is what decides when the tuft is finished, and a
     * countdown of floating-point remainders cannot say "empty" exactly
     * (`plantEnergy / plantBites` need not divide evenly).
     */
    bites: number;
    alive: boolean;
    /** The tick this tuft appeared, so how long it has stood is knowable. */
    bornTick: number;
    /** Whether it grew from a neighbouring tuft or arrived as a seed. */
    route: PlantRoute;
}

/**
 * How a tuft arrived. `sprout` grew from a neighbouring tuft — the vegetative
 * path that makes patches — and `seed` landed wherever it landed: either the
 * minority that deliberately colonise open ground (`plantColoniseChance`) or
 * one whose every spot near a parent was already taken (`plantSpacing`).
 */
export type PlantRoute = "sprout" | "seed";

/**
 * Era-resolved plant numbers, plus the bite arithmetic derived from them.
 * `World.plantParams` is what the sim, the renderer and the inspector all read
 * rather than each deriving the same division for themselves.
 */
export interface PlantParams {
    regrowPerTick: number;
    energy: number;
    maxPlants: number;
    /** Bites in a full tuft. */
    bites: number;
    /** Energy in one bite: `energy / bites`. */
    biteEnergy: number;
}

/** A dead animal: returns its unconsumed energy to the environment (rule 6). */
export interface Carrion {
    id: number;
    /** Readonly for the same reason as a plant's: a body lies where it fell. */
    readonly x: number;
    readonly y: number;
    energy: number;
    alive: boolean;
    /** The animal this body used to be, so its lineage stays knowable. */
    fromId: number;
    /** That animal's generation, so a scavenged meal can report how deep into
     * the lineage the body sat — the same figure a hunted kill reports. */
    fromGeneration: number;
    /** The tick on which this animal died. */
    deathTick: number;
    /** Why it died: "starvation", "old age", or "preyed". */
    deathReason: string;
}

/**
 * How a population propagates. Chosen at seeding and locked for the run, like
 * the era presets and the season cycle (rule 2: nothing about a run may be
 * changed after it is seeded).
 *
 * There are two modes and no middle ground, on purpose. A sexual animal that
 * cannot find a partner does not reproduce at all — it does not clone "as a
 * fallback", because that is not what sexual reproduction means, and a mode
 * that sometimes mates and sometimes clones cannot be reasoned about: it
 * would silently report clonal births from a run the player set to sexual.
 *
 * - `sexual`: a birth needs a partner. Without one the animal keeps its
 *   energy, stays off cooldown and tries again next tick, so an animal that
 *   never meets a mate simply never breeds.
 * - `asexual`: every birth is a clone of one parent, and no mate is ever
 *   sought. This is what runs have always done in practice, so it is the
 *   default and reproduces the validated baselines exactly.
 */
export type ReproductionMode = "asexual" | "sexual";

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
    /** Mean and deepest recorded ancestry among the living, in generations
     * since the founders. How far back the population's forebears run. */
    livingMeanDepth: number;
    livingMaxDepth: number;
    /** Share of living animals with at least one living ancestor (any depth up
     * to the cap), and the mean generations up to it over those that have one.
     * A high share means the population is still one family rather than
     * separate lines, which is what lineage thinning would erode. */
    kinDensity: number;
    meanNearestKin: number;
    /** Cumulative corpses eaten by carnivores, and how many of those were
     * blood kin of the eater. Cumulative, so the pair yields a lifetime rate
     * rather than a session one. */
    carrionMeals: number;
    kinMeals: number;
    /** That kin total split by direction: a forebear eaten vs an offspring
     * eaten. Kept apart because a run shows a very lopsided split. */
    kinAncestorMeals: number;
    kinDescendantMeals: number;
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
    /**
     * Bites in a full tuft (default 1 = the whole tuft at once).
     *
     * `plantEnergy` is shared evenly among them, so one bite is worth
     * `plantEnergy / plantBites` and the tuft is finished by the last one. The
     * food a tuft is worth is therefore unchanged — what changes is that a
     * grazer can take it in mouthfuls without leaving the patch, which is a
     * change to how hard the food is to *reach*, not to how much there is.
     */
    plantBites?: number;
    maxPlants: number;
    /** Simulation ticks between snapshots. One "turn" = one snapshot. */
    turnLength: number;
    populationCap: number;
    /** Distance within which a same-species neighbor is eligible as a mate. */
    /** How far an animal can reach for a partner. Only consulted in sexual
     * mode; asexual never looks for one. */
    mateRange: number;
    /** How this run's populations propagate. Defaults to "asexual". */
    reproduction?: ReproductionMode;
    mutationRate: number;
    mutationSigma: number;
    brainSpec: BrainSpec;
    /**
     * Ticks per seasonal plant cycle; 0 disables seasons (default). The regrow
     * rate oscillates around plantRegrowPerTick, so the long-run average is
     * unchanged — only the timing of abundance changes.
     */
    plantSeasonLength?: number;
    /** 0..1 seasonal trough depth (default 0.5): 1 starves plants fully. */
    plantSeasonDepth?: number;
    /**
     * How far a new plant may appear from the plant it grew from, in world
     * units; 0 gives every plant an independent uniform position (default).
     *
     * This is what gives vegetation geography. An even sprinkle leaves an
     * animal with nothing spatial to learn — food is equally dense everywhere,
     * so "where the food is" is not a fact about any place, and the best
     * available strategy is to eat whatever is in reach and wander. Growing
     * from an existing plant instead makes patches, so ranging somewhere
     * becomes worth something.
     */
    plantSpread?: number;
    /**
     * How close two plants may stand, in world units (default 0 = no limit).
     *
     * This is what makes a patch a patch instead of a single lump. Growing from
     * a random existing plant is rich-get-richer — the biggest clump is the one
     * most likely to be picked — so without a local limit the vegetation
     * collapses into one blob and stops looking like a landscape at all. A
     * saturated patch pushes its next seed elsewhere instead.
     */
    plantSpacing?: number;
    /**
     * 0..1 chance that a new plant colonises open ground anywhere instead of
     * growing from an existing plant (default 0). Without any, a patch grazed
     * to nothing could never come back and the world would end up bare rather
     * than patchy.
     */
    plantColoniseChance?: number;
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
    /** Meals kept per entity for the observer's inspector (default 24). */
    mealLogCapacity?: number;
    /** Scenario era: redisot the biome palette and species tuning per era. */
    era?: import("./era").EraConfig;
    /**
     * Fraction of maxEnergy below which a starving carnivore considers
     * same-species animals as prey (default 0 = disabled). When enabled,
     * the hunt still uses the catch-chance mechanic (with carnivore density
     * for the prey-refuge factor), so cannibalism becomes more likely when
     * predators are crowded and herbivores are scarce.
     */
    cannibalismThreshold?: number;
    /** Pre-evolved sacred founder brains from god memory (fallback to random if unset). */
    founderGenomes?: {
        herbivore?: import("./brain").Brain;
        carnivore?: import("./brain").Brain;
    };
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

/**
 * How many spots near a parent plant a seed tries before it travels instead.
 * Small on purpose: the cost of a wrong guess is one grid query, and a long
 * search in a saturated patch would just be a slower way to give up.
 */
const PLANT_SPROUT_ATTEMPTS = 4;

const EMPTY_COUNTS = (): Record<SpeciesKind, number> => ({ herbivore: 0, carnivore: 0 });
const KINDS: readonly SpeciesKind[] = ["herbivore", "carnivore"];
const REPRODUCE_COOLDOWN = 60;

/**
 * Movement-energy multiplier from steering. Turning is biomechanically
 * expensive (species.turnCost): at full steer the multiplier reaches
 * (1 + turnCost). With turnCost 0 the multiplier is exactly 1, so ordinary
 * travel is unaffected — the pressure only bites sustained hard turners.
 */
export function turnEnergyMultiplier(turnCost: number, steerMag: number, thrust: number): number {
    return 1 + turnCost * steerMag * steerMag * (0.3 + 0.7 * thrust);
}

/**
 * Seasonal regrow multiplier at a given tick: oscillates around 1 with
 * amplitude `depth` (trough = 1 - depth, peak = 1 + depth). With seasons
 * disabled (seasonLength <= 0) the multiplier is always 1.
 */
export function seasonalRegrowMultiplier(tick: number, seasonLength: number, depth: number): number {
    if (seasonLength <= 0) return 1;
    return 1 - depth * Math.sin((2 * Math.PI * tick) / seasonLength);
}

/**
 * Normalized season position for visuals: 0 = deepest trough, 1 = peak.
 * Returns 0.5 (the neutral midpoint) when seasons are disabled.
 */
export function seasonAbundanceAt(tick: number, seasonLength: number, depth: number): number {
    if (seasonLength <= 0) return 0.5;
    const multiplier = seasonalRegrowMultiplier(tick, seasonLength, depth);
    return (multiplier - (1 - depth)) / (2 * depth);
}

export class World {
    config: WorldConfig;
    rng: RNG;
    entities: Entity[] = [];
    plants: Plant[] = [];
    carrions: Carrion[] = [];
    records: TurnRecord[] = [];

    tick = 0;
    turn = 0;

    private readonly grid = new SpatialGrid<Entity>(10, (entity) => entity.pos);
    private readonly plantGrid = new SpatialGrid<Plant>(10, (plant) => plant);
    private readonly carrionGrid = new SpatialGrid<Carrion>(10, (carrion) => carrion);
    readonly lifeGrid: LifeGrid;
    /** Era-resolved plant numbers in force this run (see `PlantParams`). */
    readonly plantParams: PlantParams;
    private nextId = 1;
    private births: Record<SpeciesKind, number> = EMPTY_COUNTS();
    private deaths: Record<SpeciesKind, number> = EMPTY_COUNTS();
    private sexualBirthTotal = 0;
    private asexualBirthTotal = 0;
    /** Ancestry of every entity ever spawned, so kinship outlives the dead. */
    private readonly lineage = createLineage();
    private carrionMeals = 0;
    private kinMeals = 0;
    /** Split of `kinMeals` by direction, so the observer can see which way
     * kinship actually shows up in a run. */
    private kinAncestorMeals = 0;
    private kinDescendantMeals = 0;
    /** Fractional regrow carry-over so seasonal rates stay smooth. */
    private plantRegrowAccum = 0;
    /** Set once either species has died out; the run is over (rules forbid re-seeding). */
    private gameOverBy: SpeciesKind | null = null;
    readonly herbSpecies: SpeciesParams;
    readonly carnSpecies: SpeciesParams;

    constructor(config: WorldConfig) {
        this.config = config;
        this.rng = mulberry32(config.seed);
        const memCap = config.memoryCapacity ?? 64;
        this.lifeGrid = new LifeGrid(
            config.width,
            config.height,
            config.lifeGridCellsize ?? 6,
        );
        // Era-resolved species/plant params: an era can override any species
        // tuning knob or plant throughput. Absent era == base SPECIES params
        // passed through by reference (so mutable-Global tests still work).
        const era = config.era;
        const herb = era?.herbivore ? overlaySpecies(SPECIES.herbivore, era.herbivore) : SPECIES.herbivore;
        const carn = era?.carnivore ? overlaySpecies(SPECIES.carnivore, era.carnivore) : SPECIES.carnivore;
        const overlay = overlayPlants(
            config.plantRegrowPerTick,
            config.plantEnergy,
            config.maxPlants,
            era?.plants ?? {},
        );
        // How many mouthfuls a tuft is cut into is a seeding parameter, not an
        // era overlay: an era changes how much food there is and how fast it
        // grows, while the size of a mouthful is the same economy everywhere.
        const bites = Math.max(1, Math.floor(config.plantBites ?? 1));
        this.plantParams = { ...overlay, bites, biteEnergy: overlay.energy / bites };
        // Store resolved params so spawnEntity/reproduce can read them back.
        this.herbSpecies = herb;
        this.carnSpecies = carn;
        const herbFounder = config.founderGenomes?.herbivore;
        const carnFounder = config.founderGenomes?.carnivore;
        for (let i = 0; i < config.herbivoreCount; i++) {
            this.spawnEntity(herb, 0, undefined, undefined, undefined, createMemory(memCap), herbFounder);
        }
        for (let i = 0; i < config.carnivoreCount; i++) {
            this.spawnEntity(carn, 0, undefined, undefined, undefined, createMemory(memCap), carnFounder);
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

    /**
     * Where a new plant appears.
     *
     * Vegetation grows from vegetation: a plant usually comes up a short
     * distance from an existing one, so grass forms patches with real gaps
     * between them. A minority of plants colonise open ground anywhere, which
     * is what lets a patch that has been grazed to nothing come back.
     *
     * With `plantSpread` at 0 every plant is placed independently, which is the
     * uniform sprinkle the world used to have — kept as a setting so the two
     * can be compared rather than argued about.
     */
    private plantPosition(): { x: number; y: number; route: PlantRoute } {
        const spread = this.config.plantSpread ?? 0;
        const spacing = this.config.plantSpacing ?? 0;
        if (spread <= 0 || this.plants.length === 0) return this.seedPos();
        if (this.rng() < (this.config.plantColoniseChance ?? 0)) return this.seedPos();
        for (let attempt = 0; attempt < PLANT_SPROUT_ATTEMPTS; attempt++) {
            const parent = pick(this.rng, this.plants);
            const angle = randRange(this.rng, 0, Math.PI * 2);
            const reach = randRange(this.rng, 0, spread);
            const spot = this.clampPos({
                x: parent.x + Math.cos(angle) * reach,
                y: parent.y + Math.sin(angle) * reach,
            });
            if (this.plantsNear(spot, spacing) === 0) return { ...spot, route: "sprout" };
        }
        // Every spot near a parent is taken, so this one travels: a patch that
        // has filled up seeds the ground around it instead of packing itself
        // tighter.
        //
        // Landing it anywhere at all measured *better* here than steering it
        // towards open ground, which is worth recording because the reverse
        // looks obvious. Aiming travellers at empty space flattened the
        // production field (dispersion 11.9 -> 5.9), weakened the gradient a
        // forager could learn (best-patch persistence 1.44x -> 1.23x) and cost
        // the desert its carnivores, while an unsentimental uniform landing
        // kept patches sharp by occasionally dropping a seed back into one.
        return this.seedPos();
    }

    /** A spot anywhere in the world: what a seed that travels lands on. */
    private seedPos(): { x: number; y: number; route: PlantRoute } {
        return { ...this.randomPos(), route: "seed" };
    }

    /** How many living plants stand within `radius` of a spot. */
    private plantsNear(spot: { x: number; y: number }, radius: number): number {
        if (radius <= 0) return 0;
        const near: Plant[] = [];
        this.plantGrid.query(spot.x, spot.y, radius, near);
        let count = 0;
        for (const plant of near) {
            if (plant.alive) count++;
        }
        return count;
    }

    private spawnPlant(): void {
        const spot = this.plantPosition();
        const plant: Plant = {
            id: this.nextId++,
            x: spot.x,
            y: spot.y,
            energy: this.plantParams.energy,
            bites: this.plantParams.bites,
            alive: true,
            bornTick: this.tick,
            route: spot.route,
        };
        this.plants.push(plant);
        // A plant is filed when it appears and never touched again, because it
        // never moves: there is nothing about a plant that can go stale. It is
        // filed here rather than at the tick's sync point because regrowth
        // happens before that point, and the rebuild this replaced ran after
        // regrowth — so a plant grown this tick was grazed this tick.
        this.plantGrid.insert(plant);
    }

    private spawnEntity(
        species: SpeciesParams,
        generation: number,
        parent?: Entity,
        secondParent?: Entity,
        childEnergy?: number,
        memory?: Memory,
        initialBrain?: Brain,
    ): Entity {
        const pos = parent
            ? this.clampPos({
                  x: parent.pos.x + randRange(this.rng, -2, 2),
                  y: parent.pos.y + randRange(this.rng, -2, 2),
              })
            : this.randomPos();
        let brain: Brain;
        if (parent) {
            brain = secondParent
                ? parent.brain.crossover(secondParent.brain, this.rng)
                : parent.brain.clone();
            brain.mutate(this.config.mutationRate, this.config.mutationSigma, this.rng);
        } else if (initialBrain) {
            brain = initialBrain.clone();
            brain.mutate(this.config.mutationRate, this.config.mutationSigma, this.rng);
        } else {
            brain = Brain.random(this.config.brainSpec, this.rng);
        }
        const entity = new Entity(
            species,
            pos,
            randRange(this.rng, 0, Math.PI * 2),
            brain,
            this.nextId++,
            childEnergy ?? species.reproduceEnergy * 0.5,
            memory ?? createMemory(this.config.memoryCapacity ?? 64),
            createMealLog(this.config.mealLogCapacity),
        );
        entity.generation = generation;
        if (secondParent && parent) {
            entity.parentIds = [parent.id, secondParent.id];
        } else if (parent) {
            // An asexual clone has one parent, recorded twice. Slot 1 used to
            // hold the grandparent instead, which made it mean a second parent
            // for a mated spawn and a grandparent for a clone — so no reader
            // could tell how far up an ancestor actually sat. Ancestry is a
            // walk now (src/sim/lineage.ts), so the slot can just say "parent".
            entity.parentIds = [parent.id, parent.id];
        }
        // Record the link before the entity can ever die: the population keeps
        // only the living, so a chain must survive its own ancestors.
        this.lineage.add(entity.id, entity.parentIds);
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
        // Seasonal cycles (plantSeasonLength > 0) modulate the rate around the
        // same average: the trough starves herbivores and the peak booms them,
        // an environmental survival pressure distinct from predation.
        const seasonLength = this.config.plantSeasonLength ?? 0;
        const seasonDepth = this.config.plantSeasonDepth ?? 0.5;
        this.plantRegrowAccum +=
            this.plantParams.regrowPerTick * seasonalRegrowMultiplier(this.tick, seasonLength, seasonDepth);
        while (this.plantRegrowAccum >= 1) {
            if (this.plants.length >= this.plantParams.maxPlants) {
                this.plantRegrowAccum = 0;
                break;
            }
            this.spawnPlant();
            this.plantRegrowAccum -= 1;
        }

        this.syncIndexes();

        // Update every entity.
        for (const entity of this.entities) {
            if (entity.alive) this.updateEntity(entity);
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

    /** Sweep the dead, unhooking each from its index as it leaves. */
    private sweepTheDead(): void {
        this.entities = World.sweep(this.entities, this.grid);
        this.plants = World.sweep(this.plants, this.plantGrid);
    }

    /** Carrion decays naturally; fully decayed corpses vanish (rule 6). */
    private decayCarrion(): void {
        const decay = this.config.carrionDecayPerTick ?? 0.05;
        for (const corpse of this.carrions) {
            if (corpse.alive) corpse.energy -= decay;
            if (corpse.energy <= 0) corpse.alive = false;
        }
        this.carrions = World.sweep(this.carrions, this.carrionGrid);
    }

    /** Light population-level life-grid bookkeeping. */
    private recordPopulationDensity(): void {
        if (this.tick % 4 !== 0) return;
        for (const entity of this.entities) {
            if (entity.alive) this.lifeGrid.record(entity.pos.x, entity.pos.y, 0.25);
        }
    }

    /**
     * Bring the three indexes up to date, in place.
     *
     * This replaces a full rebuild and sits at the same point in the tick as
     * the rebuild did, which is what makes it a pure speed change: a query in
     * this tick sees the same items at the same positions it always did. That
     * timing is load-bearing in both directions, so it is worth stating:
     *
     * - An animal born during the previous tick is filed here, not at birth.
     *   Filed at birth it would have been visible to a predator later in the
     *   very tick it was born, which the rebuild never allowed.
     * - Corpses follow the same rule: a body left by a kill this tick becomes
     *   scavengeable at the next sync, so a kill and a scavenging of it cannot
     *   collapse into the same tick.
     * - Nothing is taken out here. The dead are unhooked by the sweep at the
     *   end of the tick that killed them, which is the tick the rebuild would
     *   have started skipping them.
     */
    private syncIndexes(): void {
        // Entities are the only things that move, so they are the only ones
        // worth re-checking. `update` is a no-op for everything that stayed in
        // its cell, which is most of the population on most ticks.
        for (const entity of this.entities) {
            if (entity.alive) this.grid.update(entity);
        }
        for (const corpse of this.carrions) {
            if (corpse.alive) this.carrionGrid.update(corpse);
        }
    }

    /** Drop the dead from a list, and from the index that held them. */
    private static sweep<T extends { alive: boolean }>(items: T[], index: SpatialGrid<T>): T[] {
        const kept: T[] = [];
        for (const item of items) {
            if (item.alive) kept.push(item);
            else index.remove(item);
        }
        return kept;
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
        const turnPenalty = turnEnergyMultiplier(s.turnCost, steerMag, thrust);
        // Charged even when the animal cannot pay for it: the step has already
        // been taken. `spend` stops the charge at zero rather than letting a
        // starving animal run on credit it can never repay.
        World.spend(e, s.moveCost * (0.3 + 0.7 * thrust) * turnPenalty);

        this.tryEat(e, inputs, steer);

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

    private sense(entity: Entity): Sense | null {
        const species = entity.species;
        if (species.kind === "herbivore") {
            const found = this.nearest(
                this.queryPlants(entity.pos, species.senseRange),
                (plant) => plant.alive,
                (plant) => plant,
                entity.pos,
            );
            return found ? { dx: found.dx, dy: found.dy, dist: Math.sqrt(found.d2) } : null;
        }

        // A threshold of 0 means "off", and has to be checked as such:
        // energy dips slightly below zero before an animal dies, so
        // comparing that dip against `0 * maxEnergy` reads it as starvation
        // and lets a nominally disabled feature hunt its own kind.
        const cannibalThreshold = this.config.cannibalismThreshold ?? 0;
        const starving = cannibalThreshold > 0 && entity.energy < cannibalThreshold * species.maxEnergy;
        const found = this.nearest(
            this.queryEntities(entity.pos, species.senseRange),
            (candidate) =>
                candidate.alive &&
                (candidate.species.kind === "herbivore" ||
                    (starving && candidate !== entity && candidate.species.kind === species.kind)),
            (candidate) => candidate.pos,
            entity.pos,
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

    private tryGraze(entity: Entity, inputs: number[], steer: number): void {
        const species = entity.species;
        const found = this.nearest(
            this.queryPlants(entity.pos, species.eatRadius),
            (plant) => plant.alive,
            (plant) => plant,
            entity.pos,
        );
        if (found) {
            // One mouthful, not the whole tuft: the eater takes a bite's
            // worth and the rest stays standing for the next bite — this
            // grazer's or another's. The `bites` countdown is what finishes
            // the tuft, so it is worth exactly `plantBites` mouthfuls
            // however `plantEnergy` divides into them.
            const target = found.item;
            const bite = Math.min(target.energy, this.plantParams.biteEnergy);
            target.bites--;
            target.energy = Math.max(0, target.energy - bite);
            if (target.bites <= 0) {
                target.alive = false;
            }
            entity.energy += bite;
            entity.fitness += bite;
            entity.foodEaten++;
            // Remember exactly how we were steering when the bite landed:
            // this is the action episodic memory will recall to bias later
            // steering toward food.
            entity.memory.record(inputs, steer, bite, entity.age);
            entity.meals.add({ source: "plant", energy: bite, age: entity.age });
        }
    }

    private tryHunt(entity: Entity, inputs: number[], steer: number): void {
        const species = entity.species;
        // A threshold of 0 means "off", and has to be checked as such:
        // energy dips slightly below zero before an animal dies, so
        // comparing that dip against `0 * maxEnergy` reads it as starvation
        // and lets a nominally disabled feature hunt its own kind.
        const cannibalThreshold = this.config.cannibalismThreshold ?? 0;
        const starving = cannibalThreshold > 0 && entity.energy < cannibalThreshold * species.maxEnergy;
        const found = this.nearest(
            this.queryEntities(entity.pos, species.eatRadius),
            (target) =>
                target.alive &&
                (target.species.kind === "herbivore" ||
                    (starving && target !== entity && target.species.kind === species.kind)),
            (target) => target.pos,
            entity.pos,
        );
        if (!found) return;

        // Type-III functional response with a hard prey refuge: when
        // prey are rare, hunts almost always fail, so predators starve
        // back before they can finish the prey off. When prey are
        // abundant, hunts saturate and predators can boom.
        const isCannibal = found.item.species.kind === species.kind;
        const preyDensity =
            this.populationOf(isCannibal ? "carnivore" : "herbivore") /
            (this.config.width * this.config.height);
        const scarcity = Math.min(1, preyDensity / PREY_REFUGE_DENSITY);
        const factor = scarcity * scarcity * scarcity * SATURATION_BONUS + REFUGE_FLOOR;
        if (this.rng() < CATCH_CHANCE * factor) {
            const meat = found.item.energy;
            this.kill(found.item, "preyed");
            const gained = Math.min(meat * 0.6, species.maxEnergy * 0.5) + species.foodEnergy;
            entity.energy += gained;
            entity.fitness += gained;
            entity.foodEaten++;
            entity.memory.record(inputs, steer, gained, entity.age);
            entity.meals.add({
                source: "prey",
                energy: gained,
                age: entity.age,
                victimId: found.item.id,
                victimGeneration: found.item.generation,
            });
        }
    }

    private tryScavenge(entity: Entity, inputs: number[], steer: number): void {
        const species = entity.species;
        // Scavenging: carrion is free energy with no hunt risk (rule 6).
        const corpses: Carrion[] = [];
        this.carrionGrid.query(entity.pos.x, entity.pos.y, species.eatRadius, corpses);
        for (const corpse of corpses) {
            if (!corpse.alive) continue;
            const gained = corpse.energy;
            corpse.alive = false;
            entity.energy = Math.min(species.maxEnergy, entity.energy + gained);
            entity.fitness += gained;
            entity.foodEaten++;
            // Kin can be met here, or in the hunt above when cannibalism
            // is enabled and the hunter is starving.  Offspring always
            // inherit their parent's species, so a predator's relatives
            // are carnivores — reached as carrion normally, or as live
            // prey only under desperation.
            //
            // Both directions are asked for deliberately. A parent that
            // dies leaves a body its offspring may still be standing next
            // to; an offspring that dies has usually wandered off first.
            // Checking only one way quietly reports zero forever.
            const kin = this.lineage.kinTo(entity.id, corpse.fromId);
            entity.memory.record(inputs, steer, gained, entity.age);
            const meal = {
                source: "carrion" as const,
                energy: gained,
                age: entity.age,
                victimId: corpse.fromId,
                victimGeneration: corpse.fromGeneration,
            };
            entity.meals.add(
                kin === null
                    ? meal
                    : {
                          ...meal,
                          kin: true,
                          kinRelation: kin.side,
                          kinGeneration: kin.generations,
                      },
            );
            this.carrionMeals++;
            if (kin !== null) {
                this.kinMeals++;
                if (kin.side === "ancestor") {
                    this.kinAncestorMeals++;
                } else {
                    this.kinDescendantMeals++;
                }
            }
            break;
        }
    }

    private tryEat(entity: Entity, inputs: number[], steer: number): void {
        if (entity.species.kind === "herbivore") {
            this.tryGraze(entity, inputs, steer);
            return;
        }
        this.tryHunt(entity, inputs, steer);
        this.tryScavenge(entity, inputs, steer);
    }

    private reproduce(e: Entity): void {
        const s = e.species;
        let alive = 0;
        for (const other of this.entities) {
            if (other.alive && other.species.kind === s.kind) alive++;
        }
        if (alive >= this.config.populationCap) return;

        const mode = this.config.reproduction ?? "asexual";
        // Asexual never looks for a partner at all, so it cannot accidentally
        // become sexual when one happens to be standing nearby.
        const mate = mode === "sexual" ? this.findMate(e) : null;
        // Sexual without a partner is not a birth: the animal waits, keeping
        // its energy and its cooldown clear, and tries again next tick. There
        // is deliberately no clone fallback — that is the whole difference
        // between the two modes.
        if (mode === "sexual" && mate === null) return;
        // Newborns start well below the breeding threshold: they must eat
        // before they can reproduce, which tempers exponential booms.
        const childEnergy = s.reproduceEnergy * 0.25;
        const generation = mate
            ? Math.max(e.generation, mate.generation) + 1
            : e.generation + 1;
        // Every birth in sexual mode has a partner, and every birth in asexual
        // mode is a clone, so the two cases cannot blur.
        for (let i = 0; i < s.litterSize; i++) {
            this.spawnEntity(s, generation, e, mate ?? undefined, childEnergy);
        }
        if (mate) {
            World.spend(e, s.reproduceCost / 2);
            World.spend(mate, s.reproduceCost / 2);
            mate.reproduceCooldown = REPRODUCE_COOLDOWN;
            this.sexualBirthTotal += s.litterSize;
        } else {
            World.spend(e, s.reproduceCost);
            this.asexualBirthTotal += s.litterSize;
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

    private kill(e: Entity, reason: string): void {
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
                fromId: e.id,
                fromGeneration: e.generation,
                deathTick: this.tick,
                deathReason: reason,
            });
        }
    }

    /**
     * Charge an animal for something it did, without letting its energy go
     * below zero.
     *
     * Energy is spent before it is known whether the animal will eat this tick,
     * and the last step of its life is usually one it cannot quite afford, so an
     * unclamped charge left it briefly negative. That state has no meaning — it
     * cannot pay for movement it has already made — and it reads as "starving"
     * to anything comparing energy against zero.
     */
    private static spend(e: Entity, amount: number): void {
        e.energy = Math.max(0, e.energy - amount);
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

    private recordSpeciesMetrics(record: TurnRecord): void {
        for (const kind of KINDS) {
            const pop = this.entities.filter((entity) => entity.alive && entity.species.kind === kind);
            const count = pop.length;
            record.populations[kind] = count;
            record.avgEnergy[kind] = count
                ? pop.reduce((sum, entity) => sum + entity.energy, 0) / count
                : 0;
            record.avgGeneration[kind] = count
                ? pop.reduce((sum, entity) => sum + entity.generation, 0) / count
                : 0;
            record.geneDiversity[kind] = this.geneDiversity(kind);
            record.avgFitness[kind] = count
                ? pop.reduce((sum, entity) => sum + entity.fitness, 0) / count
                : 0;
            record.maxFitness[kind] = count
                ? Math.max(...pop.map((entity) => entity.fitness))
                : 0;
        }
    }

    private recordLivingAncestry(record: TurnRecord, living: readonly Entity[]): void {
        const livingIds = new Set(living.map((entity) => entity.id));
        let depthSum = 0;
        let withKin = 0;
        let kinGapSum = 0;
        for (const entity of living) {
            depthSum += entity.generation;
            if (entity.generation > record.livingMaxDepth) {
                record.livingMaxDepth = entity.generation;
            }
            const gap = this.lineage.nearestLivingAncestor(entity.id, livingIds);
            if (gap !== null) {
                withKin++;
                kinGapSum += gap;
            }
        }
        record.livingMeanDepth = living.length ? depthSum / living.length : 0;
        record.kinDensity = living.length ? withKin / living.length : 0;
        record.meanNearestKin = withKin ? kinGapSum / withKin : 0;
    }

    private recordSnapshot(): void {
        const living = this.entities.filter((entity) => entity.alive);
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
            plantCount: this.plants.filter((plant) => plant.alive).length,
            livingMeanDepth: 0,
            livingMaxDepth: 0,
            kinDensity: 0,
            meanNearestKin: 0,
            carrionMeals: this.carrionMeals,
            kinMeals: this.kinMeals,
            kinAncestorMeals: this.kinAncestorMeals,
            kinDescendantMeals: this.kinDescendantMeals,
        };
        this.recordSpeciesMetrics(record);
        this.recordLivingAncestry(record, living);

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
     * Cumulative births made with a partner, and by cloning.
     *
     * Not shown anywhere: the mode is locked at seeding and the two are meant
     * to be mutually exclusive (a sexual run makes no clones at all, and an
     * asexual run never mates), so a display of the split would only restate a
     * setting the player already chose. They exist so the tests can hold that
     * exclusivity to account rather than assuming it.
     */
    get sexualBirths(): number {
        return this.sexualBirthTotal;
    }

    get asexualBirths(): number {
        return this.asexualBirthTotal;
    }

    /** Lifetime count of corpses eaten by carnivores. */
    get carrionMealsEaten(): number {
        return this.carrionMeals;
    }

    /** Lifetime count of those corpses that were blood kin of the eater. */
    get kinMealsEaten(): number {
        return this.kinMeals;
    }

    /** Kin meals where the eater ate a forebear (usually its own parent). */
    get kinAncestorMealsEaten(): number {
        return this.kinAncestorMeals;
    }

    /** Kin meals where the eater ate one of its own offspring. */
    get kinDescendantMealsEaten(): number {
        return this.kinDescendantMeals;
    }

    /** How many entities have recorded ancestry (groundwork for a pedigree). */
    get lineageSize(): number {
        return this.lineage.size();
    }

    /**
     * Normalized current season position for visuals: 0 = deepest trough,
     * 1 = peak; 0.5 when seasons are disabled.
     */
    get seasonAbundance(): number {
        return seasonAbundanceAt(this.tick, this.config.plantSeasonLength ?? 0, this.config.plantSeasonDepth ?? 0.5);
    }

    /**
     * Observer tool (docs/game-rules.md "觀察者工具"): the sensory inputs an
     * entity is currently receiving — exactly what updateEntity feeds the
     * brain. Read-only, so the inspector can show which episodic memories
     * match the entity's present situation.
     */
    inputsFor(e: Entity): number[] {
        return this.buildInputs(e, this.sense(e));
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