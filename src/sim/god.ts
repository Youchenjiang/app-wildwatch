import type { World } from "./world";
import type { GodMemory, SerializedBrainWeights, SpeciesKind } from "./types";
import { createDefaultGodMemory } from "./persistence";
import { Brain } from "./brain";

export interface DivineInterventionEvent {
    tick: number;
    action: "bountifulRain" | "metabolicBlight" | "rebalanceSocialCohesion";
    reason: string;
}

export class GodAgent {
    readonly world: World;
    memory: GodMemory;
    lastInterventionTick = -9999;
    readonly history: DivineInterventionEvent[] = [];
    evalInterval: number;

    constructor(world: World, initialMemory?: GodMemory, evalInterval = 200) {
        this.world = world;
        this.memory = initialMemory ?? createDefaultGodMemory();
        this.evalInterval = evalInterval;
    }

    tick(): void {
        const tick = this.world.tick;
        if (tick % this.evalInterval !== 0) return;

        this.evaluateEcosystem(tick);
        this.harvestSacredSeeds();
    }

    private evaluateEcosystem(tick: number): void {
        const herbs = this.world.populationOf("herbivore");
        const carns = this.world.populationOf("carnivore");

        if (herbs === 0 || carns === 0) return;

        const cooldown = this.memory.policy.interventionCooldown;
        if (tick - this.lastInterventionTick < cooldown) return;

        // Emergency 1: Prey collapse -> Bountiful Rain
        if (herbs <= this.memory.policy.rainPreyThreshold) {
            this.bountifulRain(30);
            this.lastInterventionTick = tick;
            this.history.push({
                tick,
                action: "bountifulRain",
                reason: `Prey collapsed to ${herbs} (threshold ${this.memory.policy.rainPreyThreshold})`,
            });
            // Temporarily soften pack coordination to ease predation pressure
            if (this.world.config.socialMode === "pack") {
                this.world.setSocialMode("pack", Math.max(0.2, (this.world.config.socialCohesion ?? 1.0) * 0.7));
            }
            return;
        }

        // Emergency 2: Predator boom -> Metabolic Blight
        if (carns >= this.memory.policy.blightPredatorThreshold) {
            this.metabolicBlight();
            this.lastInterventionTick = tick;
            this.history.push({
                tick,
                action: "metabolicBlight",
                reason: `Predators exploded to ${carns} (threshold ${this.memory.policy.blightPredatorThreshold})`,
            });
            return;
        }

        // Adaptive Cohesion Tuning: If predators are struggling to hunt (< 6), boost pack cohesion
        if (carns < 6 && this.world.config.socialMode === "pack") {
            const currentCohesion = this.world.config.socialCohesion ?? 0.5;
            if (currentCohesion < 0.95) {
                const newCohesion = Math.min(1.0, currentCohesion + 0.15);
                this.world.setSocialMode("pack", newCohesion);
                this.history.push({
                    tick,
                    action: "rebalanceSocialCohesion",
                    reason: `Carnivores endangered (${carns}), boosted pack cohesion to ${newCohesion.toFixed(2)}`,
                });
            }
        }
    }

    /** Shower the ecosystem with high-energy plants to prevent herbivore starvation. */
    bountifulRain(count = 25): void {
        for (let i = 0; i < count; i++) {
            if (this.world.plants.length >= this.world.config.maxPlants) break;
            this.world.spawnPlant();
        }
    }

    /** Thin out the oldest and weakest predators to avert an ecological crash. */
    metabolicBlight(): void {
        const carns = this.world.entities
            .filter((e) => e.alive && e.species.kind === "carnivore")
            .sort((a, b) => a.energy - b.energy || b.age - a.age);

        const cullCount = Math.min(carns.length - 4, Math.ceil(carns.length * 0.25));
        for (const carn of carns.slice(0, cullCount)) {
            this.world.cullEntity(carn, "metabolic blight");
        }
    }

    /** Observe top-performing organisms and archive champion genomes into sacred seeds. */
    harvestSacredSeeds(): void {
        const kinds: SpeciesKind[] = ["herbivore", "carnivore"];
        let updated = false;
        for (const kind of kinds) {
            const pool = this.world.entities.filter((e) => e.alive && e.species.kind === kind);
            if (pool.length === 0) continue;

            const champion = pool.reduce((best, e) => (e.fitness > best.fitness ? e : best), pool[0]);

            const currentSeed = this.memory.sacredSeeds[kind];
            if (!currentSeed || champion.fitness > currentSeed.fitness) {
                this.memory.sacredSeeds[kind] = {
                    species: kind,
                    fitness: Math.round(champion.fitness),
                    spec: champion.brain.spec,
                    weights: GodAgent.serializeBrain(champion.brain),
                };
                updated = true;
            }
        }
        if (updated) {
            this.memory.updatedAt = new Date().toISOString();
            this.memory.eons = (this.memory.eons || 1) + 1;
        }
    }

    private static serializeBrain(brain: Brain): SerializedBrainWeights {
        return {
            w1: Array.from(brain.w1).map((weight) => Number(weight.toFixed(5))),
            b1: Array.from(brain.b1).map((weight) => Number(weight.toFixed(5))),
            w2: Array.from(brain.w2).map((weight) => Number(weight.toFixed(5))),
            b2: Array.from(brain.b2).map((weight) => Number(weight.toFixed(5))),
        };
    }

    /** Export the latest GodMemory state as a downloadable JSON string. */
    exportMemory(): GodMemory {
        return structuredClone(this.memory);
    }
}
