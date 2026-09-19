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
    actionHint: number;     // signed steer hint that worked (+/-)
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
    /** Per-tick decay of trace weights by age distance. */
    age(age: number): void;
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
            const f = feature;
            const fl = Math.min(f.length, MAX_IDX);
            const out: { episode: Episode; similarity: number }[] = [];
            for (let i = 0; i < traces.length; i++) {
                const t = traces[i];
                const tf = t.feature;
                let dot = 0;
                let nf = 0;
                let nt = 0;
                for (let j = 0; j < fl; j++) {
                    dot += f[j] * tf[j];
                    nf += f[j] * f[j];
                    nt += tf[j] * tf[j];
                }
                const denom = Math.sqrt(nf) * Math.sqrt(nt);
                const sim = denom > 0 ? dot / denom : 0;
                out.push({ episode: t, similarity: sim });
            }
            out.sort((a, b) => b.similarity - a.similarity);
            return out.slice(0, limit);
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