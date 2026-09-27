import type { ReplayFrame } from "../observe/replay";
import { seasonAbundanceAt } from "../sim/world";
import type { World, TurnRecord } from "../sim/world";

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
        for (const r of recent) max = Math.max(max, pick(r));
    }
    const step = CHART_WIDTH / (CHART_SPAN - 1);
    const base = recent.length < CHART_SPAN ? CHART_SPAN - recent.length : 0;
    return recent
        .map((r, i) => {
            const x = (base + i) * step;
            const y = CHART_HEIGHT - (pick(r) / max) * (CHART_HEIGHT - 4) - 2;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
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

    const q = <T extends Element>(sel: string): T => {
        const found = el.querySelector<T>(sel);
        if (!found) throw new Error(`Missing HUD element: ${sel}`);
        return found;
    };
    // The game-over veil is a sibling of the HUD, so its own children are
    // queried within overEl — querying the HUD would return null and crash
    // the frame loop the moment a run ends.
    const qOver = <T extends Element>(sel: string): T => {
        const found = overEl.querySelector<T>(sel);
        if (!found) throw new Error(`Missing HUD element: ${sel}`);
        return found;
    };
    const stateEl = q("#hud-state");
    const turnEl = q("#hud-turn");
    const popHerbEl = q("#pop-herb");
    const popCarnEl = q("#pop-carn");
    const barHerbEl = q<HTMLElement>("#bar-herb");
    const barCarnEl = q<HTMLElement>("#bar-carn");
    const metaHerbEl = q("#meta-herb");
    const metaCarnEl = q("#meta-carn");
    const lineHerbEl = q("#line-herb");
    const lineCarnEl = q("#line-carn");
    const linePlantEl = q("#line-plant");
    const lineSeasonEl = q("#line-season");
    const overTitleEl = qOver("#over-title");
    const overSubEl = qOver("#over-sub");

    return {
        update(world: World, paused: boolean, replay?: ReplayFrame): void {
            // While scrubbing, the live world keeps advancing; show the
            // replayed point instead: history up to the frame's tick and the
            // season position the frame carries.
            const records = replay
                ? world.records.filter((recordItem) => recordItem.tick <= replay.tick)
                : world.records;
            const record = records.at(-1);
            const herb = replay ? replay.populations.herbivore : world.populationOf("herbivore");
            const carn = replay ? replay.populations.carnivore : world.populationOf("carnivore");
            const plantCount = replay ? replay.populations.plants : world.plants.filter((plantItem) => plantItem.alive).length;

            const seasonLen = world.config.plantSeasonLength ?? 0;
            const seasonDepth = world.config.plantSeasonDepth ?? 0.5;
            let abundance: number | null = null;
            if (replay) {
                abundance = replay.seasonAbundance;
            } else if (seasonLen > 0) {
                abundance = world.seasonAbundance;
            }
            const seasonSuffix = abundance === null ? "" : ` · 季節 ${Math.round(abundance * 100)}%`;
            turnEl.textContent =
                `回合 ${replay ? replay.turn : world.turn} · tick ${replay ? replay.tick : world.tick} · 🌱 ${plantCount}${seasonSuffix}`;
            popHerbEl.textContent = String(herb);
            popCarnEl.textContent = String(carn);

            if (record) {
                barHerbEl.style.width = `${Math.min(100, record.avgEnergy.herbivore).toFixed(0)}%`;
                barCarnEl.style.width = `${Math.min(100, record.avgEnergy.carnivore).toFixed(0)}%`;
                metaHerbEl.textContent =
                    `均能 ${record.avgEnergy.herbivore.toFixed(0)} · 世代 ${record.avgGeneration.herbivore.toFixed(0)} · 生 ${record.births.herbivore} 死 ${record.deaths.herbivore}`;
                metaCarnEl.textContent =
                    `均能 ${record.avgEnergy.carnivore.toFixed(0)} · 世代 ${record.avgGeneration.carnivore.toFixed(0)} · 生 ${record.births.carnivore} 死 ${record.deaths.carnivore}`;
            }

            const over = world.gameOver;
            if (over !== null) {
                const name = over === "herbivore" ? "草食" : "肉食";
                stateEl.textContent = "訓練結束";
                stateEl.className = "hud-state dead";
                overEl.hidden = false;
                overTitleEl.textContent = `${name}族群滅絕`;
                overSubEl.innerHTML = `本次訓練於回合 ${world.turn} 結束 · 共 ${world.tick} ticks<br>按 <kbd>R</kbd> 重新投放`;
            } else {
                stateEl.textContent = paused ? "已暫停" : "運行中";
                stateEl.className = paused ? "hud-state paused" : "hud-state live";
            }

            if (records.length > 1) {
                lineHerbEl.setAttribute("points", seriesPoints(records, (rec) => rec.populations.herbivore));
                lineCarnEl.setAttribute("points", seriesPoints(records, (rec) => rec.populations.carnivore));
                linePlantEl.setAttribute("points", seriesPoints(records, (rec) => rec.plantCount));
                if (seasonLen > 0) {
                    // The season curve: where in the cycle each snapshot sat
                    // (0 = trough, 1 = peak), pinned to fill the chart. In a
                    // replay it ends at the scrubbed tick, not the live one.
                    lineSeasonEl.setAttribute(
                        "points",
                        seriesPoints(records, (rec) => seasonAbundanceAt(rec.tick, seasonLen, seasonDepth), 1),
                    );
                } else {
                    lineSeasonEl.setAttribute("points", "");
                }
            }
        },
    };
}
