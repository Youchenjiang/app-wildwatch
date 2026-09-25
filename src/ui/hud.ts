import type { ReplayFrame } from "../observe/replay";
import { seasonAbundanceAt } from "../sim/world";
import type { World, TurnRecord } from "../sim/world";
import type { SpeciesKind } from "../sim/types";

export interface Hud {
    /** Pass a replay frame while scrubbing so the HUD follows the historical tick. */
    update(world: World, paused: boolean, replay?: ReplayFrame): void;
}

const CHART_WIDTH = 180;
const CHART_HEIGHT = 40;
const CHART_SPAN = 80; // how many recent turns the chart shows

const HERB_COLOR = "#d7f05a";
const CARN_COLOR = "#ff7b6b";
const PLANT_COLOR = "#57c26e";
const SEASON_COLOR = "#e6b45a";

/**
 * Population stat for kin feeding: of all the corpses carnivores have eaten,
 * how many were blood kin of the eater. Kin can only ever arrive as carrion —
 * a carnivore's relatives are carnivores too, and it only hunts herbivores —
 * so this is the rate at which a lineage recycles its own dead.
 *
 * The two directions are named because they come out very lopsided: a dead
 * parent is lying where its offspring still stands, while a dead offspring has
 * usually wandered off, so in practice the forebear side carries almost all of
 * it. Showing one blended number would hide that.
 */
export function kinStatText(
    carrionMeals: number,
    kinMeals: number,
    kinAncestorMeals = 0,
    kinDescendantMeals = 0,
): string {
    if (carrionMeals <= 0) return "近親取食 —";
    const pct = Math.round((kinMeals / carrionMeals) * 100);
    // Only break the total down when the two sides actually account for it.
    // A caller that passes no split (both zero with meals on the books) gets
    // no claim rather than an invented "all forebears".
    const sides =
        kinMeals <= 0 || kinAncestorMeals + kinDescendantMeals !== kinMeals
            ? ""
            : kinDescendantMeals === 0
              ? "（全為親代）"
              : `（親代 ${kinAncestorMeals} · 子代 ${kinDescendantMeals}）`;
    return `近親取食 ${kinMeals} · 佔腐食 ${pct}%${sides}`;
}

/** What the game-over veil says, and whether it belongs on screen at all. */
export interface GameOverVeil {
    hidden: boolean;
    /** The species that died out, e.g. 草食族群滅絕. Empty while hidden. */
    title: string;
    sub: string;
}

/**
 * Derive the game-over veil from the run's state.
 *
 * Deliberately derived rather than toggled on the way up: `hidden` comes back
 * true for a live run, so a finished run's veil cannot survive into the next
 * one. It used to be shown when a run ended and never taken down again, which
 * meant pressing R to start over left the previous run's numbers covering the
 * middle of the screen for good.
 */
export function gameOverVeil(over: SpeciesKind | null, turn: number, tick: number): GameOverVeil {
    if (over === null) return { hidden: true, title: "", sub: "" };
    const name = over === "herbivore" ? "草食" : "肉食";
    return {
        hidden: false,
        title: `${name}族群滅絕`,
        sub: `本次訓練於回合 ${turn} 結束 · 共 ${tick} ticks<br>按 <kbd>R</kbd> 重新投放`,
    };
}

/**
 * SVG polyline points for a series of the last N records, scaled to 0..max.
 * Pass `fixedMax` to pin the scale instead of scaling to the series' own max
 * (used by the season curve, whose 0..1 range should fill the chart).
 */
function seriesPoints(
    records: TurnRecord[],
    pick: (r: TurnRecord) => number,
    fixedMax?: number,
): string {
    const recent = records.slice(-CHART_SPAN);
    if (recent.length === 0) return "";
    let max = fixedMax ?? 1;
    if (fixedMax === undefined) {
        for (const record of recent) max = Math.max(max, pick(record));
    }
    const step = CHART_WIDTH / (CHART_SPAN - 1);
    const base = recent.length < CHART_SPAN ? CHART_SPAN - recent.length : 0;
    return recent
        .map((record, index) => {
            const x = (base + index) * step;
            const y = CHART_HEIGHT - (pick(record) / max) * (CHART_HEIGHT - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
}
interface HudCounts {
    turn: number;
    tick: number;
    herb: number;
    carn: number;
    plantCount: number;
    abundance: number | null;
}

function resolveHudCounts(world: World, replay?: ReplayFrame): HudCounts {
    if (replay) {
        return {
            turn: replay.turn,
            tick: replay.tick,
            herb: replay.populations.herbivore,
            carn: replay.populations.carnivore,
            plantCount: replay.populations.plants,
            abundance: replay.seasonAbundance,
        };
    }
    const seasonLen = world.config.plantSeasonLength ?? 0;
    const livingPlants = world.plants.filter((plantItem) => plantItem.alive).length;
    return {
        turn: world.turn,
        tick: world.tick,
        herb: world.populationOf("herbivore"),
        carn: world.populationOf("carnivore"),
        plantCount: livingPlants,
        abundance: seasonLen > 0 ? world.seasonAbundance : null,
    };
}

function formatSeasonSuffix(abundance: number | null): string {
    if (abundance === null) return "";
    return ` · 季節 ${Math.round(abundance * 100)}%`;
}

function updateMetrics(
    record: TurnRecord | undefined,
    barHerbEl: HTMLElement,
    barCarnEl: HTMLElement,
    metaHerbEl: Element,
    metaCarnEl: Element,
    kinEl: Element,
): void {
    if (!record) return;
    barHerbEl.style.width = `${Math.min(100, record.avgEnergy.herbivore).toFixed(0)}%`;
    barCarnEl.style.width = `${Math.min(100, record.avgEnergy.carnivore).toFixed(0)}%`;
    metaHerbEl.textContent =
        `均能 ${record.avgEnergy.herbivore.toFixed(0)} · 世代 ${record.avgGeneration.herbivore.toFixed(0)} · 生 ${record.births.herbivore} 死 ${record.deaths.herbivore}`;
    metaCarnEl.textContent =
        `均能 ${record.avgEnergy.carnivore.toFixed(0)} · 世代 ${record.avgGeneration.carnivore.toFixed(0)} · 生 ${record.births.carnivore} 死 ${record.deaths.carnivore}`;
    kinEl.textContent = kinStatText(
        record.carrionMeals,
        record.kinMeals,
        record.kinAncestorMeals,
        record.kinDescendantMeals,
    );
}

function updateStateBanner(
    world: World,
    paused: boolean,
    stateEl: Element,
    overEl: HTMLElement,
    overTitleEl: Element,
    overSubEl: Element,
): void {
    const veil = gameOverVeil(world.gameOver, world.turn, world.tick);
    overEl.hidden = veil.hidden;
    if (!veil.hidden) {
        stateEl.textContent = "訓練結束";
        stateEl.className = "hud-state dead";
        overTitleEl.textContent = veil.title;
        overSubEl.innerHTML = veil.sub;
        return;
    }
    if (paused) {
        stateEl.textContent = "已暫停";
        stateEl.className = "hud-state paused";
    } else {
        stateEl.textContent = "運行中";
        stateEl.className = "hud-state live";
    }
}

function updateSparklines(
    records: TurnRecord[],
    seasonLen: number,
    seasonDepth: number,
    lineHerbEl: Element,
    lineCarnEl: Element,
    linePlantEl: Element,
    lineSeasonEl: Element,
): void {
    if (records.length <= 1) return;
    lineHerbEl.setAttribute("points", seriesPoints(records, (rec) => rec.populations.herbivore));
    lineCarnEl.setAttribute("points", seriesPoints(records, (rec) => rec.populations.carnivore));
    linePlantEl.setAttribute("points", seriesPoints(records, (rec) => rec.plantCount));
    if (seasonLen > 0) {
        lineSeasonEl.setAttribute(
            "points",
            seriesPoints(records, (rec) => seasonAbundanceAt(rec.tick, seasonLen, seasonDepth), 1),
        );
    } else {
        lineSeasonEl.setAttribute("points", "");
    }
}

export function createHud(container: HTMLElement): Hud {
    const el = document.createElement("div");
    el.id = "hud";
    el.innerHTML = `
        <div class="hud-head">
            <span class="hud-title">演化觀察者</span>
            <span class="hud-state" id="hud-state">運行中</span>
        </div>
        <div class="hud-turn" id="hud-turn">回合 0 · tick 0</div>

        <div class="hud-species">
            <div class="hud-card" id="card-herb">
                <div class="hud-card-head">
                    <span class="dot herb"></span><span>草食</span>
                    <span class="hud-pop-num" id="pop-herb">0</span>
                </div>
                <div class="bar"><i id="bar-herb"></i></div>
                <div class="hud-meta" id="meta-herb">—</div>
            </div>
            <div class="hud-card" id="card-carn">
                <div class="hud-card-head">
                    <span class="dot carn"></span><span>肉食</span>
                    <span class="hud-pop-num" id="pop-carn">0</span>
                </div>
                <div class="bar"><i id="bar-carn"></i></div>
                <div class="hud-meta" id="meta-carn">—</div>
            </div>
        </div>

        <div class="hud-stat" id="hud-kin">—</div>

        <div class="hud-chart">
            <div class="hud-chart-legend">
                <span class="key"><i style="background:${HERB_COLOR}"></i>草食</span>
                <span class="key"><i style="background:${CARN_COLOR}"></i>肉食</span>
                <span class="key"><i style="background:${PLANT_COLOR}"></i>草</span>
                <span class="key"><i style="background:${SEASON_COLOR}"></i>季節</span>
            </div>
            <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none">
                <polyline id="line-season" fill="none" stroke="${SEASON_COLOR}" stroke-width="1" stroke-dasharray="4 3" opacity="0.5" points=""/>
                <polyline id="line-plant" fill="none" stroke="${PLANT_COLOR}" stroke-width="1" opacity="0.55" points=""/>
                <polyline id="line-herb" fill="none" stroke="${HERB_COLOR}" stroke-width="1.5" points=""/>
                <polyline id="line-carn" fill="none" stroke="${CARN_COLOR}" stroke-width="1.5" points=""/>
            </svg>
        </div>
        <div class="hud-help">空白鍵 暫停 · +/− 速度 · R 重新投放</div>
    `;
    container.appendChild(el);

    const overEl = document.createElement("div");
    overEl.id = "hud-over";
    overEl.hidden = true;
    overEl.innerHTML = `
        <div class="over-title" id="over-title"></div>
        <div class="over-sub" id="over-sub"></div>
    `;
    container.appendChild(overEl);

    const queryHud = <T extends Element>(sel: string): T => {
        const found = el.querySelector<T>(sel);
        if (!found) throw new Error(`Missing HUD element: ${sel}`);
        return found;
    };
    // The game-over veil is a sibling of the HUD, so its own children are
    // queried within overEl — querying the HUD would return null and crash
    // the frame loop the moment a run ends.
    const queryOver = <T extends Element>(sel: string): T => {
        const found = overEl.querySelector<T>(sel);
        if (!found) throw new Error(`Missing HUD element: ${sel}`);
        return found;
    };
    const stateEl = queryHud("#hud-state");
    const turnEl = queryHud("#hud-turn");
    const popHerbEl = queryHud("#pop-herb");
    const popCarnEl = queryHud("#pop-carn");
    const barHerbEl = queryHud<HTMLElement>("#bar-herb");
    const barCarnEl = queryHud<HTMLElement>("#bar-carn");
    const metaHerbEl = queryHud("#meta-herb");
    const metaCarnEl = queryHud("#meta-carn");
    const kinEl = queryHud("#hud-kin");
    const lineHerbEl = queryHud("#line-herb");
    const lineCarnEl = queryHud("#line-carn");
    const linePlantEl = queryHud("#line-plant");
    const lineSeasonEl = queryHud("#line-season");
    const overTitleEl = queryOver("#over-title");
    const overSubEl = queryOver("#over-sub");

    return {
        update(world: World, paused: boolean, replay?: ReplayFrame): void {
            const records = replay
                ? world.records.filter((recordItem) => recordItem.tick <= replay.tick)
                : world.records;
            const counts = resolveHudCounts(world, replay);
            const seasonSuffix = formatSeasonSuffix(counts.abundance);

            turnEl.textContent = `回合 ${counts.turn} · tick ${counts.tick} · 🌱 ${counts.plantCount}${seasonSuffix}`;
            popHerbEl.textContent = String(counts.herb);
            popCarnEl.textContent = String(counts.carn);

            updateMetrics(records.at(-1), barHerbEl, barCarnEl, metaHerbEl, metaCarnEl, kinEl);
            updateStateBanner(world, paused, stateEl, overEl, overTitleEl, overSubEl);

            const seasonLen = world.config.plantSeasonLength ?? 0;
            const seasonDepth = world.config.plantSeasonDepth ?? 0.5;
            updateSparklines(records, seasonLen, seasonDepth, lineHerbEl, lineCarnEl, linePlantEl, lineSeasonEl);
        },
    };
}
