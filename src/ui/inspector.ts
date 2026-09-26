import type { Entity } from "../sim/entity";
import { cosineSimilarity } from "../sim/memory";
import type { World } from "../sim/world";

const MEMORY_ROWS = 8;

interface MemoryRow {
    similarity: number;
    actionHint: number;
    reward: number;
    ago: number;
}

/**
 * Selected-entity inspector card. Reads a live entity each frame; during
 * replay it shows the last live snapshot (frozen) and says so. The memory
 * panel lists the entity's most recent episodic traces with their similarity
 * to the current senses, so you can watch lifelong learning as it happens.
 */
export interface EntityInspector {
    show(id: number): void;
    hide(): void;
    /** Refresh against the live world; pass null during replay to freeze. */
    update(world: World | null): void;
    selectedId(): number | null;
}

export function createInspector(container: HTMLElement): EntityInspector {
    const card = document.createElement("div");
    card.id = "inspector";
    card.hidden = true;
    container.appendChild(card);

    let current: number | null = null;
    let cached: Entity | null = null;
    let cachedRows: MemoryRow[] = [];

    function memoryRows(e: Entity, world: World): MemoryRow[] {
        const inputs = world.inputsFor(e);
        return e.memory.recent(MEMORY_ROWS).map((ep) => ({
            similarity: cosineSimilarity(inputs, ep.feature),
            actionHint: ep.actionHint,
            reward: ep.reward,
            ago: e.age - ep.age,
        }));
    }

    function render(e: Entity, frozenNow: boolean, rows: MemoryRow[]): void {
        const s = e.species;
        const kindName = s.kind === "herbivore" ? "草食" : "肉食";
        card.innerHTML = `
            <div class="insp-head">
                <span class="dot ${s.kind === "herbivore" ? "herb" : "carn"}"></span>
                <span>${kindName} #${e.id}</span>
                <button id="insp-close" title="關閉">✕</button>
            </div>
            <div class="insp-rows">
                <div><span>能量</span><b>${e.energy.toFixed(1)} / ${s.maxEnergy}</b></div>
                <div><span>年齡</span><b>${e.age} / ${s.maxAge} ticks</b></div>
                <div><span>世代</span><b>${e.generation}</b></div>
                <div><span>進食次數</span><b>${e.foodEaten}</b></div>
                <div><span>適應度</span><b>${e.fitness.toFixed(0)}</b></div>
                <div><span>繁殖冷卻</span><b>${e.reproduceCooldown} ticks</b></div>
                <div><span>速度上限</span><b>${s.speed}</b></div>
                <div><span>感應範圍</span><b>${s.senseRange}</b></div>
                <div><span>記憶片段</span><b>${e.memory.size()}</b></div>
                ${frozenNow ? `<div class="insp-frozen">☠ 個體已死亡（或重播檢視）— 顯示最後快照</div>` : ""}
            </div>
            <div class="insp-mem-title">記憶 · 最近 ${rows.length} 條</div>
            ${
                rows.length === 0
                    ? '<div class="insp-mem-empty">尚無記憶 — 還沒吃過東西</div>'
                    : `<div class="insp-mem">
                        <div class="insp-mem-head"><span>相似</span><span>轉向</span><span>獎勵</span><span>多久前</span></div>
                        ${rows
                            .map(
                                (r) => `
                        <div class="insp-mem-row">
                            <i style="color:${simColor(r.similarity)}">${r.similarity.toFixed(2)}</i>
                            <span>${formatSteer(r.actionHint)}</span>
                            <b>+${r.reward.toFixed(0)}</b>
                            <em>${r.ago}t</em>
                        </div>`,
                            )
                            .join("")}
                    </div>`
            }
        `;
        card.querySelector("#insp-close")?.addEventListener("click", () => cardOwner().hide());
    }

    // Slight indirection so the close button can call hide() before assignment completes.
    let selfRef: EntityInspector | null = null;
    function cardOwner(): EntityInspector {
        return selfRef!;
    }

    const inspector: EntityInspector = {
        show(id: number): void {
            current = id;
            cached = null;
            cachedRows = [];
            card.hidden = false;
        },
        hide(): void {
            current = null;
            cached = null;
            cachedRows = [];
            card.hidden = true;
        },
        update(world: World | null): void {
            if (current === null) return;
            if (world === null) {
                return;
            }
            const e = world.entities.find((x) => x.id === current && x.alive);
            if (!e) {
                // The subject died (or we are in replay): keep the last live
                // snapshot visible as a frozen card until the user closes it.
                if (cached) render(cached, true, cachedRows);
                return;
            }
            cached = e;
            cachedRows = memoryRows(e, world);
            render(e, false, cachedRows);
        },
        selectedId(): number | null {
            return current;
        },
    };
    selfRef = inspector;
    return inspector;
}

function formatSteer(h: number): string {
    return `${h >= 0 ? "+" : ""}${h.toFixed(2)}`;
}

function simColor(s: number): string {
    if (s >= 0.6) return "#8fdc6f";
    if (s >= 0.2) return "#e6cf7a";
    return "#8ba595";
}