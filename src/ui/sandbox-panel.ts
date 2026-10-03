import type { World } from "../sim/world";

export interface SandboxPanelCallbacks {
    onIntervention?(): void;
}

export interface SandboxPanel {
    show(): void;
    hide(): void;
    toggle(): void;
    isOpen(): boolean;
    update(): void;
}

export function createSandboxPanel(
    container: HTMLElement,
    getWorld: () => World,
    callbacks?: SandboxPanelCallbacks,
): SandboxPanel {
    const panel = document.createElement("div");
    panel.id = "sandbox-panel";
    panel.className = "sandbox-panel";
    panel.hidden = true;
    panel.innerHTML = `
        <div class="sb-head">
            <span class="sb-title">🧪 沙盒實驗面板</span>
            <button type="button" class="sb-close" id="sb-close" title="關閉">✕</button>
        </div>
        <div class="sb-notice">
            ⚠️ 調整參數將標記本局為「人為干預」，演化資料與自然基準隔離。
        </div>

        <div class="sb-section">
            <div class="sb-label">繁殖模式 (Reproduction Mode)</div>
            <div class="sb-btn-row">
                <button type="button" id="sb-mode-asexual" class="sb-mode-btn">🌱 無性生殖</button>
                <button type="button" id="sb-mode-sexual" class="sb-mode-btn">❤️ 有性生殖</button>
            </div>
            <div class="sb-mode-desc" id="sb-mode-desc"></div>
        </div>

        <div class="sb-section">
            <div class="sb-label">
                草生長速率: <b id="sb-regrow-label">1.00</b> / tick
            </div>
            <div class="sb-slider-row">
                <input type="range" id="sb-regrow-slider" min="0.1" max="4.0" step="0.1" value="1.0" />
            </div>
        </div>

        <div class="sb-section">
            <div class="sb-label">生態注入</div>
            <button type="button" id="sb-burst-btn" class="sb-action-btn">🌧️ 降下甘霖 (+15 叢草)</button>
        </div>

        <div class="sb-section sb-log-section">
            <div class="sb-label">干預紀錄 (<span id="sb-log-count">0</span> 次)</div>
            <div class="sb-logs" id="sb-logs">無干預紀錄</div>
        </div>
    `;
    container.appendChild(panel);

    const findEl = <T extends HTMLElement>(sel: string): T => {
        const el = panel.querySelector<T>(sel);
        if (!el) throw new Error(`Missing sandbox element: ${sel}`);
        return el;
    };

    const closeBtn = findEl<HTMLButtonElement>("#sb-close");
    const asexualBtn = findEl<HTMLButtonElement>("#sb-mode-asexual");
    const sexualBtn = findEl<HTMLButtonElement>("#sb-mode-sexual");
    const modeDescEl = findEl<HTMLElement>("#sb-mode-desc");
    const regrowSlider = findEl<HTMLInputElement>("#sb-regrow-slider");
    const regrowValLabel = findEl<HTMLElement>("#sb-regrow-label");
    const burstBtn = findEl<HTMLButtonElement>("#sb-burst-btn");
    const logCountEl = findEl<HTMLElement>("#sb-log-count");
    const logsEl = findEl<HTMLElement>("#sb-logs");

    const refresh = (): void => {
        const world = getWorld();
        const mode = world.config.reproduction ?? "asexual";
        asexualBtn.classList.toggle("active", mode === "asexual");
        sexualBtn.classList.toggle("active", mode === "sexual");
        modeDescEl.textContent =
            mode === "asexual"
                ? "目前：自我複製，能量達標即可產子。"
                : "目前：有性生殖，須尋找鄰近伴侶並均攤能量。";

        const regrow = world.config.plantRegrowPerTick;
        regrowSlider.value = regrow.toFixed(1);
        regrowValLabel.textContent = regrow.toFixed(2);

        logCountEl.textContent = String(world.interventions.length);
        if (world.interventions.length === 0) {
            logsEl.textContent = "尚未進行人為干預（自然基準狀態）";
        } else {
            logsEl.innerHTML = world.interventions
                .slice(-5)
                .map((ev) => `<div class="sb-log-item">tick ${ev.tick}: ${ev.action}</div>`)
                .join("");
        }
    };

    closeBtn.addEventListener("click", () => {
        panel.hidden = true;
    });

    asexualBtn.addEventListener("click", () => {
        const world = getWorld();
        world.setReproductionMode("asexual");
        refresh();
        callbacks?.onIntervention?.();
    });

    sexualBtn.addEventListener("click", () => {
        const world = getWorld();
        world.setReproductionMode("sexual");
        refresh();
        callbacks?.onIntervention?.();
    });

    regrowSlider.addEventListener("input", () => {
        const world = getWorld();
        const val = Number.parseFloat(regrowSlider.value);
        world.setPlantRegrowRate(val);
        refresh();
        callbacks?.onIntervention?.();
    });

    burstBtn.addEventListener("click", () => {
        const world = getWorld();
        world.spawnPlantBurst(15);
        refresh();
        callbacks?.onIntervention?.();
    });

    return {
        show(): void {
            panel.hidden = false;
            refresh();
        },
        hide(): void {
            panel.hidden = true;
        },
        toggle(): void {
            panel.hidden = !panel.hidden;
            if (!panel.hidden) {
                refresh();
            }
        },
        isOpen(): boolean {
            return !panel.hidden;
        },
        update(): void {
            if (!panel.hidden) {
                refresh();
            }
        },
    };
}
