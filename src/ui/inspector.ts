import type { Entity } from "../sim/entity";
import { cosineSimilarity } from "../sim/memory";
import type { Meal, MealSource } from "../sim/meals";
import type { Carrion, Plant, World } from "../sim/world";

const MEMORY_ROWS = 8;
const MEAL_ROWS = 6;

const MEAL_LABEL: Record<MealSource, string> = {
    plant: "植物",
    prey: "獵物",
    carrion: "屍體",
};

/** What a kin meal is labelled in the list: which way the kinship ran. */
const KIN_LABEL: Record<"ancestor" | "descendant", string> = {
    ancestor: "親代",
    descendant: "子代",
};

const DEATH_REASON_LABEL: Record<string, string> = {
    starvation: "餓死",
    "old age": "壽終",
    preyed: "被獵殺",
};

interface MemoryRow {
    similarity: number;
    actionHint: number;
    reward: number;
    ago: number;
}

/**
 * Selected-subject inspector card. Reads a live entity each frame; during
 * replay it shows the last live snapshot (frozen) and says so. The memory
 * panel lists the entity's most recent episodic traces with their similarity
 * to the current senses, so you can watch lifelong learning as it happens; the
 * meal panel lists what it has actually eaten, so you can see whether that
 * learning is producing a grazer, a hunter or a scavenger.
 *
 * A tuft can be selected the same way (the sim gives animals and plants one id
 * space), and its card answers what a tuft is in this model: how many bites it
 * has left, what one bite is worth, how long it has stood, and how it got here.
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
    let cachedMeals: Meal[] = [];
    let cachedPlant: Plant | null = null;

    function memoryRows(e: Entity, world: World): MemoryRow[] {
        const inputs = world.inputsFor(e);
        return e.memory.recent(MEMORY_ROWS).map((ep) => ({
            similarity: cosineSimilarity(inputs, ep.feature),
            actionHint: ep.actionHint,
            reward: ep.reward,
            ago: e.age - ep.age,
        }));
    }

    function render(e: Entity, frozenNow: boolean, rows: MemoryRow[], meals: Meal[]): void {
        const s = e.species;
        const kindName = s.kind === "herbivore" ? "草食" : "肉食";
        const counts = e.meals.counts();
        const kin = e.meals.kinCount();
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
            <div class="insp-mem-title">
                進食 · 最近 ${meals.length} 條
                <span class="insp-meal-sum">植物 ${counts.plant} · 獵物 ${counts.prey} · 屍體 ${counts.carrion}${
                    kin > 0 ? ` · <b class="meal-kin">血親 ${kin}</b>` : ""
                }</span>
            </div>
            ${
                meals.length === 0
                    ? '<div class="insp-mem-empty">尚未進食</div>'
                    : `<div class="insp-mem insp-meals">
                        <div class="insp-mem-head"><span>來源</span><span>能量</span><span>世代</span><span>多久前</span></div>
                        ${meals
                            .map(
                                (mealItem) => `
                        <div class="insp-mem-row${mealItem.kin ? " kin" : ""}"${
                            mealItem.kin
                                ? ` title="近親取食 · 相差 ${mealItem.kinGeneration} 代"`
                                : ""
                        }>
                            <i class="meal-src ${mealItem.source}">${
                                mealItem.kin ? KIN_LABEL[mealItem.kinRelation ?? "ancestor"] : MEAL_LABEL[mealItem.source]
                            }</i>
                            <b>+${mealItem.energy.toFixed(0)}</b>
                            <span>${mealItem.victimGeneration === undefined ? "—" : `G${mealItem.victimGeneration}`}</span>
                            <em>${e.age - mealItem.age}t</em>
                        </div>`,
                            )
                            .join("")}
                    </div>`
            }
        `;
        card.querySelector("#insp-close")?.addEventListener("click", () => cardOwner().hide());
    }

    /**
     * The corpse card. Shows when and how the animal died.
     */
    function renderCorpse(corpse: Carrion, world: World): void {
        const ageAtDeath = world.tick - corpse.deathTick;
        const deathReasonLabel = DEATH_REASON_LABEL[corpse.deathReason] ?? corpse.deathReason;
        card.innerHTML = `
            <div class="insp-head">
                <span class="dot carn"></span>
                <span>屍體 #${corpse.id}</span>
                <button id="insp-close" title="關閉">✕</button>
            </div>
            <div class="insp-rows">
                <div><span>原始個體</span><b>#${corpse.fromId}（世代 ${corpse.fromGeneration}）</b></div>
                <div><span>死亡 tick</span><b>${corpse.deathTick}</b></div>
                <div><span>死亡原因</span><b>${deathReasonLabel}</b></div>
                <div><span>已死亡</span><b>${ageAtDeath} ticks</b></div>
                <div><span>剩餘能量</span><b>${corpse.energy.toFixed(1)}</b></div>
            </div>
        `;
        card.querySelector("#insp-close")?.addEventListener("click", () => cardOwner().hide());
    }

    /**
     * The tuft card. `bites` is the sim's own countdown, so "how many bites
     * left" is read rather than recomputed from a remainder.
     */
    function renderPlant(plant: Plant, world: World, frozenNow: boolean): void {
        const params = world.plantParams;
        const route = plant.route === "sprout" ? "走莖（長在母株旁）" : "種子（隨機落地）";
        card.innerHTML = `
            <div class="insp-head">
                <span class="dot plant"></span>
                <span>草叢 #${plant.id}</span>
                <button id="insp-close" title="關閉">✕</button>
            </div>
            <div class="insp-rows">
                <div><span>剩餘口數</span><b>${plant.bites} / ${params.bites}</b></div>
                <div><span>能量</span><b>${plant.energy.toFixed(1)} / ${params.energy}（每口 ${params.biteEnergy.toFixed(1)}）</b></div>
                <div><span>年齡</span><b>${world.tick - plant.bornTick} ticks</b></div>
                <div><span>可繁殖</span><b>隨時（無成熟期）</b></div>
                <div><span>來源</span><b>${route}</b></div>
                ${frozenNow ? '<div class="insp-frozen">☠ 已被吃完（或重播檢視）— 顯示最後快照</div>' : ""}
            </div>
        `;
        card.querySelector("#insp-close")?.addEventListener("click", () => cardOwner().hide());
    }

    // Slight indirection so the close button can call hide() before assignment completes.
    let selfRef: EntityInspector | null = null;
    function cardOwner(): EntityInspector {
        if (!selfRef) throw new Error("Inspector not initialized");
        return selfRef;
    }

    const inspector: EntityInspector = {
        show(id: number): void {
            current = id;
            cached = null;
            cachedRows = [];
            cachedMeals = [];
            cachedPlant = null;
            card.hidden = false;
        },
        hide(): void {
            current = null;
            cached = null;
            cachedRows = [];
            cachedMeals = [];
            cachedPlant = null;
            card.hidden = true;
        },
        update(world: World | null): void {
            if (current === null) return;
            if (world === null) {
                return;
            }
            const targetEntity = world.entities.find((candidate) => candidate.id === current && candidate.alive);
            if (!targetEntity) {
                // A selected id that is not an animal may be a tuft: plants and
                // animals share the sim's id space, so the click needs no kind.
                const targetPlant = world.plants.find((candidate) => candidate.id === current && candidate.alive);
                if (targetPlant) {
                    cachedPlant = targetPlant;
                    renderPlant(targetPlant, world, false);
                    return;
                }
                // Check if it's a corpse
                const targetCorpse = world.carrions.find((carrion) => carrion.id === current && carrion.alive);
                if (targetCorpse) {
                    renderCorpse(targetCorpse, world);
                    return;
                }
                // The subject left the world (eaten, killed, or we are in
                // replay): keep the last live snapshot visible as a frozen card
                // until the user closes it.
                if (cached) render(cached, true, cachedRows, cachedMeals);
                else if (cachedPlant) renderPlant(cachedPlant, world, true);
                return;
            }
            cachedPlant = null;
            cached = targetEntity;
            cachedRows = memoryRows(targetEntity, world);
            cachedMeals = [...targetEntity.meals.recent(MEAL_ROWS)];
            render(targetEntity, false, cachedRows, cachedMeals);
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