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
const DEPTH_COLOR = "#8fd6ff";
const DEEPEST_COLOR = "#5c9fd6";
const KIN_COLOR = "#e08fb0";

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
function formatKinSides(
    kinMeals: number,
    kinAncestorMeals: number,
    kinDescendantMeals: number,
): string {
    if (kinMeals <= 0 || kinAncestorMeals + kinDescendantMeals !== kinMeals) {
        return "";
    }
    if (kinDescendantMeals === 0) {
        return "（全為親代）";
    }
    return `（親代 ${kinAncestorMeals} · 子代 ${kinDescendantMeals}）`;
}

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
    const sides = formatKinSides(kinMeals, kinAncestorMeals, kinDescendantMeals);
    return `近親取食 ${kinMeals} · 佔腐食 ${pct}%${sides}`;
}

/**
 * Stat text for the reproduction breakdown.
 */
export function birthModeText(sexual: number, asexual: number): string {
    if (sexual + asexual === 0) return "繁殖 —";
    return `繁殖 有性 ${sexual} · 無性 ${asexual}`;
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
 * How this run's births were made, so the seeding choice is visible in the run
 * rather than only in the config.
 *
 * It matters because the modes differ quietly: a mixed run with no eligible
 * partner in reach clones every single time, which reports the same numbers as
 * asexual. Showing the split means that is read off the run instead of assumed
 * from the setting.
 */
export function birthModeText(sexual: number, asexual: number): string {
    if (sexual + asexual === 0) return "繁殖 —";
    return `繁殖 有性 ${sexual} · 無性 ${asexual}`;
}

/**
 * The scale the two ancestry-depth lines share: the deepest reading in the
 * window. Sharing it is the point — each line scaled to its own maximum would
 * render the mean and the deepest on top of each other, and the gap between
 * them (how much of the population sits near the deep end versus the tail) is
 * the thing worth seeing. Never zero, so the division is always safe.
 */
export function depthScale(records: TurnRecord[]): number {
    let max = 0;
    for (const r of records.slice(-CHART_SPAN)) max = Math.max(max, r.livingMaxDepth);
    return Math.max(1, max);
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

interface LineageLegendElements {
    depth: Element;
    deepest: Element;
    kin: Element;
    near: Element;
}

function updateMetrics(
    record: TurnRecord | undefined,
    barHerbEl: HTMLElement,
    barCarnEl: HTMLElement,
    metaHerbEl: Element,
    metaCarnEl: Element,
    birthsEl: Element,
    kinEl: Element,
    lineageLeg: LineageLegendElements,
): void {
    if (!record) return;
    barHerbEl.style.width = `${Math.min(100, record.avgEnergy.herbivore).toFixed(0)}%`;
    barCarnEl.style.width = `${Math.min(100, record.avgEnergy.carnivore).toFixed(0)}%`;
    metaHerbEl.textContent =
        `均能 ${record.avgEnergy.herbivore.toFixed(0)} · 世代 ${record.avgGeneration.herbivore.toFixed(0)} · 生 ${record.births.herbivore} 死 ${record.deaths.herbivore}`;
    metaCarnEl.textContent =
        `均能 ${record.avgEnergy.carnivore.toFixed(0)} · 世代 ${record.avgGeneration.carnivore.toFixed(0)} · 生 ${record.births.carnivore} 死 ${record.deaths.carnivore}`;
    birthsEl.textContent = birthModeText(record.sexualBirths, record.asexualBirths);
    kinEl.textContent = kinStatText(
        record.carrionMeals,
        record.kinMeals,
        record.kinAncestorMeals,
        record.kinDescendantMeals,
    );
    lineageLeg.depth.textContent = String(Math.round(record.livingMeanDepth));
    lineageLeg.deepest.textContent = String(Math.round(record.livingMaxDepth));
    lineageLeg.kin.textContent = `${Math.round(record.kinDensity * 100)}%`;
    lineageLeg.near.textContent = record.meanNearestKin.toFixed(1);
}

export function updateStateBanner(
    world: { gameOver: SpeciesKind | null; turn: number; tick: number },
    paused: boolean,
    stateEl: Element,
    overEl: HTMLElement,
    overTitleEl: Element,
    overSubEl: Element,
): void {
    const veil = gameOverVeil(world.gameOver, world.turn, world.tick);
    overEl.hidden = veil.hidden;
    overEl.style.display = veil.hidden ? "none" : "";
    if (!veil.hidden) {
        stateEl.textContent = "訓練結束";
        stateEl.className = "hud-state dead";
        overTitleEl.textContent = veil.title;
        overSubEl.innerHTML = veil.sub;
        return;
    }
    overTitleEl.textContent = "";
    overSubEl.innerHTML = "";
    if (paused) {
        stateEl.textContent = "已暫停";
        stateEl.className = "hud-state paused";
    } else {
        stateEl.textContent = "運行中";
        stateEl.className = "hud-state live";
    }
}

interface SparklineElements {
    herb: Element;
    carn: Element;
    plant: Element;
    season: Element;
    depth: Element;
    deepest: Element;
    kin: Element;
}

function updateSparklines(
    records: TurnRecord[],
    seasonLen: number,
    seasonDepth: number,
    lines: SparklineElements,
): void {
    if (records.length <= 1) return;
    lines.herb.setAttribute("points", seriesPoints(records, (rec) => rec.populations.herbivore));
    lines.carn.setAttribute("points", seriesPoints(records, (rec) => rec.populations.carnivore));
    lines.plant.setAttribute("points", seriesPoints(records, (rec) => rec.plantCount));
    if (seasonLen > 0) {
        lines.season.setAttribute(
            "points",
            seriesPoints(records, (rec) => seasonAbundanceAt(rec.tick, seasonLen, seasonDepth), 1),
        );
    } else {
        lines.season.setAttribute("points", "");
    }
    const depth = depthScale(records);
    lines.depth.setAttribute("points", seriesPoints(records, (rec) => rec.livingMeanDepth, depth));
    lines.deepest.setAttribute("points", seriesPoints(records, (rec) => rec.livingMaxDepth, depth));
    lines.kin.setAttribute("points", seriesPoints(records, (rec) => rec.kinDensity, 1));
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

        <div class="hud-stat" id="hud-births">繁殖 —</div>
        <div class="hud-stat" id="hud-kin">—</div>

        <div class="hud-chart">
            <div class="hud-chart-tabs">
                <button type="button" id="tab-pop" class="on">族群</button>
                <button type="button" id="tab-lineage">血緣</button>
            </div>
            <div class="hud-chart-legend" id="legend-pop">
                <span class="key"><i style="background:${HERB_COLOR}"></i>草食</span>
                <span class="key"><i style="background:${CARN_COLOR}"></i>肉食</span>
                <span class="key"><i style="background:${PLANT_COLOR}"></i>草</span>
                <span class="key"><i style="background:${SEASON_COLOR}"></i>季節</span>
            </div>
            <div class="hud-chart-legend" id="legend-lineage">
                <span class="key"><i style="background:${DEPTH_COLOR}"></i>平均 <b id="leg-depth">0</b></span>
                <span class="key"><i style="background:${DEEPEST_COLOR}"></i>最深 <b id="leg-deepest">0</b></span>
                <span class="key"><i style="background:${KIN_COLOR}"></i>有活親 <b id="leg-kin">0%</b></span>
                <span class="key">最近 <b id="leg-near">0</b> 代</span>
            </div>
            <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none">
                <g id="group-pop">
                    <polyline id="line-season" fill="none" stroke="${SEASON_COLOR}" stroke-width="1" stroke-dasharray="4 3" opacity="0.5" points=""/>
                    <polyline id="line-plant" fill="none" stroke="${PLANT_COLOR}" stroke-width="1" opacity="0.55" points=""/>
                    <polyline id="line-herb" fill="none" stroke="${HERB_COLOR}" stroke-width="1.5" points=""/>
                    <polyline id="line-carn" fill="none" stroke="${CARN_COLOR}" stroke-width="1.5" points=""/>
                </g>
                <g id="group-lineage">
                    <polyline id="line-kin" fill="none" stroke="${KIN_COLOR}" stroke-width="1" stroke-dasharray="4 3" opacity="0.8" points=""/>
                    <polyline id="line-deepest" fill="none" stroke="${DEEPEST_COLOR}" stroke-width="1" opacity="0.7" points=""/>
                    <polyline id="line-depth" fill="none" stroke="${DEPTH_COLOR}" stroke-width="1.5" points=""/>
                </g>
            </svg>
        </div>
        <div class="hud-help">空白鍵 暫停 · +/− 速度 · R 重新投放</div>
    `;
    container.appendChild(el);

    const overEl = document.createElement("div");
    overEl.id = "hud-over";
    overEl.hidden = true;
    overEl.style.display = "none";
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
    const birthsEl = queryHud("#hud-births");
    const kinEl = queryHud("#hud-kin");
    const tabPopEl = queryHud<HTMLElement>("#tab-pop");
    const tabLineageEl = queryHud<HTMLElement>("#tab-lineage");
    const legendPopEl = queryHud<HTMLElement>("#legend-pop");
    const legendLineageEl = queryHud<HTMLElement>("#legend-lineage");
    const groupPopEl = queryHud<SVGGElement>("#group-pop");
    const groupLineageEl = queryHud<SVGGElement>("#group-lineage");
    const legDepthEl = queryHud("#leg-depth");
    const legDeepestEl = queryHud("#leg-deepest");
    const legKinEl = queryHud("#leg-kin");
    const legNearEl = queryHud("#leg-near");
    const lineDepthEl = queryHud("#line-depth");
    const lineDeepestEl = queryHud("#line-deepest");
    const lineKinEl = queryHud("#line-kin");
    const lineHerbEl = queryHud("#line-herb");
    const lineCarnEl = queryHud("#line-carn");
    const linePlantEl = queryHud("#line-plant");
    const lineSeasonEl = queryHud("#line-season");
    const overTitleEl = queryOver("#over-title");
    const overSubEl = queryOver("#over-sub");

    // Two views rather than more lines on one chart: ancestry depth is a
    // different scale from population, and six series in a 180-pixel box would
    // be unreadable. SVG groups need style.display, since `hidden` is an HTML
    // attribute and does nothing to a <g>.
    let lineageView = false;
    const applyView = (): void => {
        // style.display rather than the `hidden` attribute: `hidden` is only a
        // UA-stylesheet `display: none` and loses to `#hud .hud-chart-legend`,
        // so both legends stayed on screen in either view.
        legendPopEl.style.display = lineageView ? "none" : "";
        legendLineageEl.style.display = lineageView ? "" : "none";
        groupPopEl.style.display = lineageView ? "none" : "";
        groupLineageEl.style.display = lineageView ? "" : "none";
        tabPopEl.classList.toggle("on", !lineageView);
        tabLineageEl.classList.toggle("on", lineageView);
    };
    tabPopEl.addEventListener("click", () => {
        lineageView = false;
        applyView();
    });
    tabLineageEl.addEventListener("click", () => {
        lineageView = true;
        applyView();
    });
    applyView();

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

            updateMetrics(records.at(-1), barHerbEl, barCarnEl, metaHerbEl, metaCarnEl, birthsEl, kinEl, {
                depth: legDepthEl,
                deepest: legDeepestEl,
                kin: legKinEl,
                near: legNearEl,
            });
            updateStateBanner(world, paused, stateEl, overEl, overTitleEl, overSubEl);

            const seasonLen = world.config.plantSeasonLength ?? 0;
            const seasonDepth = world.config.plantSeasonDepth ?? 0.5;
            updateSparklines(records, seasonLen, seasonDepth, {
                herb: lineHerbEl,
                carn: lineCarnEl,
                plant: linePlantEl,
                season: lineSeasonEl,
                depth: lineDepthEl,
                deepest: lineDeepestEl,
                kin: lineKinEl,
            });
        },
    };
}
