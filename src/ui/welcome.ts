/**
 * Welcome screen shown on first load. Gives the player a brief orientation
 * before the simulation starts.
 *
 * Era picker: the player chooses a scenario era (grassland, ice age, …).
 * The selected era is passed to onStart so the run can be seeded with it.
 */
import type { EraConfig } from "../sim/era";
import type { ReproductionMode } from "../sim/world";

/** What each reproduction mode means, in the player's words. */
export const REPRODUCTION_MODES: ReadonlyArray<{
    mode: ReproductionMode;
    label: string;
    desc: string;
}> = [
    {
        mode: "asexual",
        label: "無性",
        desc: "一律自我複製，不需要伴侶（預設）",
    },
    {
        mode: "sexual",
        label: "有性",
        desc: "必須遇到伴侶才能繁殖：找不到就完全不會繁殖",
    },
];

export function createWelcome(
    container: HTMLElement,
    onStart: (era: EraConfig | undefined, reproduction: ReproductionMode) => void,
    eras: ReadonlyArray<EraConfig>,
): void {
    const el = document.createElement("div");
    el.id = "welcome";
    const modeCards = REPRODUCTION_MODES.map(
        (modeItem) => `
            <button class="mode-card" data-mode="${modeItem.mode}">${modeItem.label}</button>
        `,
    ).join("");
    const eraCards = eras
        .map(
            (eraItem) => `
            <button class="era-card" data-era="${eraItem.name}">
                <span class="era-swatch" style="background:#${eraItem.groundColor.toString(16).padStart(6, "0")}"></span>
                <span class="era-name">${eraItem.name}</span>
                <span class="era-desc">${eraDescription(eraItem)}</span>
            </button>
        `,
        )
        .join("");
    el.innerHTML = `
        <div class="welcome-icon">🧬</div>
        <div class="welcome-title">演化觀察者</div>
        <div class="welcome-sub">
            挑選一個場景，觀察<em>草食</em>與<em>肉食</em>物種在封閉世界中的生存競爭。
            <b>點擊個體</b>可查看其狀態與記憶。
            季節循環帶來環境壓力——留意種群的起伏。
        </div>
        <div class="era-picker">
            <div class="era-picker-label">選擇場景</div>
            <div class="era-cards">${eraCards}</div>
        </div>
        <div class="era-picker">
            <div class="era-picker-label">繁殖方式</div>
            <div class="mode-cards">${modeCards}</div>
            <div class="mode-desc" id="mode-desc"></div>
        </div>
        <button id="welcome-start">開始觀察</button>
        <div class="welcome-keys">空白鍵 暫停 · +/− 速度 · R 重新投放</div>
    `;
    container.appendChild(el);

    let selectedEra: EraConfig | undefined = eras[0];
    let selectedMode: ReproductionMode = REPRODUCTION_MODES[0].mode;
    const modeDescEl = el.querySelector<HTMLElement>("#mode-desc");
    const modeButtons = el.querySelectorAll<HTMLButtonElement>(".mode-card");
    const showModeDesc = (): void => {
        if (!modeDescEl) return;
        modeDescEl.textContent =
            REPRODUCTION_MODES.find((modeItem) => modeItem.mode === selectedMode)?.desc ?? "";
    };
    for (const button of modeButtons) {
        button.addEventListener("click", () => {
            const mode = button.dataset.mode;
            if (mode) {
                selectedMode = mode as ReproductionMode;
                for (const btn of modeButtons) btn.classList.toggle("on", btn === button);
                showModeDesc();
            }
        });
    }
    // Seed the default as selected, the same way the era picker does.
    if (modeButtons[0]) modeButtons[0].classList.add("on");
    showModeDesc();

    const cards = el.querySelectorAll<HTMLButtonElement>(".era-card");
    // Mark the first card as selected by default.
    if (cards[0]) cards[0].classList.add("era-selected");
    for (const card of cards) {
        card.addEventListener("click", () => {
            const eraName = card.dataset.era;
            if (eraName) {
                selectedEra = eras.find((eraItem) => eraItem.name === eraName) ?? eras[0];
                for (const cardItem of cards) cardItem.classList.toggle("era-selected", cardItem === card);
            }
        });
    }

    const startButton = el.querySelector<HTMLButtonElement>("#welcome-start");
    if (startButton) {
        startButton.addEventListener("click", () => {
            el.hidden = true;
            onStart(selectedEra, selectedMode);
        });
    }

    // Also dismiss on any key (Enter/Space starts with current selection)
    const dismiss = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
            el.hidden = true;
            onStart(selectedEra, selectedMode);
            window.removeEventListener("keydown", dismiss);
        }
    };
    window.addEventListener("keydown", dismiss);
}

function eraDescription(era: EraConfig): string {
    switch (era.name) {
        case "Grassland":
            return "溫暖草原 · 物種以現有參數運行";
        case "Ice Age":
            return "冰河世紀 · 植被稀少 · 捕食者較慢建立優勢";
        case "Desert":
            return "乾旱沙漠 · 植被稀疏但養分高 · 長旱季考驗耐力";
        default:
            return era.name;
    }
}

