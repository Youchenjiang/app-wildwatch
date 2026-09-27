/**
 * A record of what an animal has eaten, for the observer's inspector.
 *
 * This is a log **only**: nothing in the simulation reads it, so it can never
 * feed back into a decision and change a run's outcome. It exists so the
 * observer can see what a lifetime of foraging actually consisted of — how much
 * of it was plants, how much was prey it hunted, how much was carrion it
 * scavenged — right next to the episodic memories lifelong learning is built
 * from.
 *
 * Deliberately small and cheap, like memory: an entity keeps at most `capacity`
 * meals. Totals, however, keep counting after old meals are evicted, so the
 * summary stays a lifetime figure rather than a rolling one.
 */

/** Where a meal came from. */
export type MealSource = "plant" | "prey" | "carrion";

export interface Meal {
    source: MealSource;
    /** Energy actually gained from this meal. */
    energy: number;
    /** The entity's age in ticks when it ate. */
    age: number;
    /** Id of the animal eaten, when the meal was an animal (prey or the body
     * a corpse used to be). */
    victimId?: number;
    /** The victim's generation, when it was an animal — how deep into the
     * lineage this meal sat. */
    victimGeneration?: number;
    /** True when the victim was blood kin of the eater. */
    kin?: boolean;
    /** Which way the kinship ran. "descendant" means the eater ate its own
     * offspring; "ancestor" means it ate a forebear — usually a parent whose
     * body it had not moved away from. Only set alongside `kin`. */
    kinRelation?: "ancestor" | "descendant";
    /** Generations separating eater and victim: 1 = parent or child, 2 =
     * grandparent or grandchild. Only set alongside `kin`. */
    kinGeneration?: number;
}

export interface MealCounts {
    plant: number;
    prey: number;
    carrion: number;
}

export interface MealLog {
    /** Record one meal (call once per rewarding event, alongside memory). */
    add(meal: Meal): void;
    /** How many meals are still remembered. */
    size(): number;
    /** The most recent meals, newest first (observer lens for the inspector). */
    recent(limit: number): ReadonlyArray<Meal>;
    /** Lifetime count per source, which survives eviction of old meals. */
    counts(): MealCounts;
    /** Lifetime count of meals that were blood kin of the eater. */
    kinCount(): number;
}

export const DEFAULT_MEAL_CAPACITY = 24;

export function createMealLog(capacity = DEFAULT_MEAL_CAPACITY): MealLog {
    const meals: Meal[] = [];
    const counts: MealCounts = { plant: 0, prey: 0, carrion: 0 };
    let kin = 0;
    return {
        add(meal: Meal): void {
            if (meals.length >= capacity) meals.shift();
            meals.push(meal);
            counts[meal.source]++;
            if (meal.kin) kin++;
        },

        size(): number {
            return meals.length;
        },

        recent(limit: number): ReadonlyArray<Meal> {
            if (limit <= 0) return [];
            return meals.slice(-limit).reverse();
        },

        counts(): MealCounts {
            return { ...counts };
        },

        kinCount(): number {
            return kin;
        },
    };
}
