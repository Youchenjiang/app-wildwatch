/** Episodic memory for lifelong learning.

 * Each rewarding event (eating a plant as a herbivore, or a kill as a carnivore)
 * writes an episodic trace: a compact feature vector describing what the agent
 * sensed, a hint about what it did, and the energy reward it gained. Later,
 * when the agent faces a similar situation, familiar episodes can bias the
 * brain's output, so behavior improves within a single lifetime even when the
 * genome stays the same.
 *
 * This is deliberately small and cheap so the simulation can run large
 * populations. Traces older than the entity's current `age` are discarded;
 * each entity keeps at most `capacity` traces.
 */
export interface Episode {
    feature: number[];      // normalized sense signature
    actionHint: number;     // steer (∈ [-1, 1]) the entity was applying when the reward landed
    reward: number;         // energy gained this event
    age: number;            // entity age when recorded
}

export interface Memory {
    /** Re-learn the last event this tick (call once per rewarding event). */
    record(feature: number[], actionHint: number, reward: number, age: number): void;
    /** How many episodes this entity remembers. */
    size(): number;
    /** Look up traces similar to the given feature (cosine). */
    recall(
        feature: readonly number[],
        limit: number,
    ): ReadonlyArray<{ episode: Episode; similarity: number }>;
    /** The most recent traces, newest first (observer lens for the inspector). */
    recent(limit: number): ReadonlyArray<Episode>;
    /** Per-tick decay of trace weights by age distance. */
    age(age: number): void;
}

/** Cosine similarity of two feature vectors; 0 when either is zero-length. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    const minLength = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < minLength; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
}

const MAX_IDX = 20;    // feature length capped to the sim sense vector (6) in practice
const LARGER_CAP = 64;

export function createMemory(capacity = LARGER_CAP): Memory {
    const traces: Episode[] = [];
    return {
        record(feature: number[], actionHint: number, reward: number, age: number): void {
            if (traces.length >= capacity) traces.shift();
            const feat = new Float32Array(MAX_IDX);
            for (let i = 0; i < Math.min(feat.length, feature.length); i++) feat[i] = feature[i];
            traces.push({ feature: Array.from(feat), actionHint, reward, age });
        },

        size(): number {
            return traces.length;
        },

        recall(feature: readonly number[], limit: number): ReadonlyArray<{ episode: Episode; similarity: number }> {
            const out: { episode: Episode; similarity: number }[] = [];
            for (const t of traces) {
                out.push({ episode: t, similarity: cosineSimilarity(feature, t.feature) });
            }
            out.sort((a, b) => b.similarity - a.similarity);
            return out.slice(0, limit);
        },

        recent(limit: number): ReadonlyArray<Episode> {
            return traces.slice(-limit).reverse();
        },

        age(age: number): void {
            const keep: Episode[] = [];
            for (const t of traces) {
                // keep traces recorded at most age/2 back; discard stale ones
                if (age - t.age <= 200) keep.push(t);
            }
            traces.length = 0;
            for (const t of keep) traces.push(t);
        },
    };
}