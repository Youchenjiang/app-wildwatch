import type { World } from "./world";
import type { Entity } from "./entity";
import type { GodMemory, SerializedBrainWeights, SpeciesKind } from "./types";
import { createDefaultGodMemory, sacredSeedToBrain } from "./persistence";
import { Brain } from "./brain";

export interface DivineInterventionEvent {
    tick: number;
    action: "bountifulRain" | "metabolicBlight" | "rebalanceSocialCohesion" | "predatorSanctuary";
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

        if (herbs === 0 && carns === 0) return;

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

        // Emergency 3: Predator collapse -> Predator Sanctuary (肉食庇護)
        const sanctuaryThreshold = this.memory.policy.sanctuaryPredatorThreshold ?? 3;
        if (carns <= sanctuaryThreshold && herbs >= 6) {
            this.predatorSanctuary();
            this.lastInterventionTick = tick;
            this.history.push({
                tick,
                action: "predatorSanctuary",
                reason: `Carnivores endangered (${carns}), granted divine sustenance and breeding vigor`,
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

    private revitalizePredator(carn: Entity): void {
        // Ensure sufficient energy to prevent starvation and trigger reproduction
        carn.energy = Math.max(carn.energy, carn.species.reproduceEnergy * 1.15);
        carn.reproduceCooldown = 0;
        // If aging towards end of life without descendants, rejuvenate
        if (carn.age > carn.species.maxAge * 0.7) {
            carn.age = Math.floor(carn.species.maxAge * 0.25);
        }
        // Drop high-value fresh carrion right beside the carnivore
        this.world.spawnCarrionAt(
            carn.pos.x + (this.world.rng() - 0.5) * 4,
            carn.pos.y + (this.world.rng() - 0.5) * 4,
            carn.species.reproduceCost,
            -1,
            0,
            "divine sustenance",
        );
    }

    private spawnSacredPredator(pos?: { x: number; y: number }, energy?: number): void {
        const sacred = this.memory.sacredSeeds.carnivore;
        const brain = sacred ? sacredSeedToBrain(sacred) : undefined;
        this.world.spawnDivineEntity("carnivore", pos, brain, energy);
    }

    /** Revitalize endangered carnivores and drop divine sustenance to prevent species extinction. */
    predatorSanctuary(): void {
        const carnivores = this.world.entities.filter((e) => e.alive && e.species.kind === "carnivore");
        if (carnivores.length > 0) {
            for (const carn of carnivores) {
                this.revitalizePredator(carn);
            }

            // In sexual mode, an endangered predator cannot mate without a nearby partner
            if (this.world.config.reproduction === "sexual" && carnivores.length < 4) {
                const target = carnivores[0];
                this.spawnSacredPredator(
                    {
                        x: target.pos.x + (this.world.rng() - 0.5) * 2,
                        y: target.pos.y + (this.world.rng() - 0.5) * 2,
                    },
                    target.species.reproduceEnergy * 1.15,
                );
            }
        } else {
            // Extinction recovery: seed fresh champion predator from sacred seed
            this.spawnSacredPredator();
        }

        // Soften pack cohesion so solitary/endangered carnivores don't burn energy on forced high thrust
        if (this.world.config.socialMode === "pack") {
            this.world.setSocialMode("pack", 0.4);
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
