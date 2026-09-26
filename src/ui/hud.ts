import type { World } from "../sim/world";

export interface Hud {
    update(world: World): void;
}

/** Minimal HUD. The full Traditional-Chinese UI arrives in a later milestone. */
export function createHud(container: HTMLElement): Hud {
    const el = document.createElement("div");
    el.id = "hud";
    el.innerHTML = `
        <div class="hud-title">演化觀察者 · Evolution Observer</div>
        <div class="hud-row" id="hud-turn">回合 0 · tick 0</div>
        <div class="hud-row" id="hud-pop">—</div>
        <div class="hud-row" id="hud-stats">—</div>
        <div class="hud-over" id="hud-over" hidden></div>
        <div class="hud-help">空白鍵 暫停 · + / - 速度 · R 重設</div>
    `;
    container.appendChild(el);

    const turnEl = el.querySelector<HTMLElement>("#hud-turn")!;
    const popEl = el.querySelector<HTMLElement>("#hud-pop")!;
    const statsEl = el.querySelector<HTMLElement>("#hud-stats")!;
    const overEl = el.querySelector<HTMLElement>("#hud-over")!;

    return {
        update(world: World): void {
            const record = world.records.at(-1);
            turnEl.textContent = `回合 ${world.turn} · tick ${world.tick}`;
            popEl.textContent =
                `🌿 草食 ${world.populationOf("herbivore")} · 🦁 肉食 ${world.populationOf("carnivore")}` +
                ` · 🌱 植物 ${world.plants.filter((p) => p.alive).length}`;
            if (record) {
                const line = (kind: "herbivore" | "carnivore"): string =>
                    `能量 ${record.avgEnergy[kind].toFixed(1)} · 世代 ${record.avgGeneration[
                        kind
                    ].toFixed(1)} · 生 ${record.births[kind]} 死 ${record.deaths[kind]} · 多樣性 ${record.geneDiversity[
                        kind
                    ].toFixed(3)} · 最佳適配度 ${record.maxFitness[kind].toFixed(0)}`;
                statsEl.replaceChildren(
                    `🌿 ${line("herbivore")}`,
                    document.createElement("br"),
                    `🦁 ${line("carnivore")}`,
                );
            }
            const over = world.gameOver;
            if (over !== null) {
                const name = over === "herbivore" ? "草食" : "肉食";
                overEl.hidden = false;
                overEl.textContent = `💀 ${name}族群滅絕 — 本次訓練結束（回合 ${world.turn} · tick ${world.tick}）· 按 R 重新投放`;
            } else {
                overEl.hidden = true;
            }
        },
    };
}