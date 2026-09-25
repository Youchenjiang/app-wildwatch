/**
 * Welcome screen shown on first load. Gives the player a brief orientation
 * before the simulation starts.
 *
 * Era picker: the player chooses a scenario era (grassland, ice age, …).
 * The selected era is passed to onStart so the run can be seeded with it.
 */
import type { EraConfig } from "../sim/era";

export function createWelcome(
    container: HTMLElement,
    onStart: (era: EraConfig | undefined) => void,
    eras: ReadonlyArray<EraConfig>,
): void {
    const el = document.createElement("div");
    el.id = "welcome";
    const eraCards = eras
        .map(
            (e) => `
            <button class="era-card" data-era="${e.name}">
                <span class="era-swatch" style="background:#${e.groundColor.toString(16).padStart(6, "0")}"></span>
                <span class="era-name">${e.name}</span>
                <span class="era-desc">${eraDescription(e)}</span>
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
        <button id="welcome-start">開始觀察</button>
        <div class="welcome-keys">空白鍵 暫停 · +/− 速度 · R 重新投放</div>
    `;
    container.appendChild(el);

    let selectedEra: EraConfig | undefined = eras[0];
    const cards = el.querySelectorAll<HTMLButtonElement>(".era-card");
    // Mark the first card as selected by default.
    if (cards[0]) cards[0].classList.add("era-selected");
    for (const card of cards) {
        card.addEventListener("click", () => {
            const name = card.dataset!.era!;
            selectedEra = eras.find((e) => e.name === name) ?? eras[0];
            for (const c of cards) c.classList.toggle("era-selected", c === card);
        });
    }

    el.querySelector<HTMLButtonElement>("#welcome-start")!.addEventListener("click", () => {
        el.hidden = true;
        onStart(selectedEra);
    });

    // Also dismiss on any key (Enter/Space starts with current era selection)
    const dismiss = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            el.hidden = true;
            onStart(selectedEra);
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

