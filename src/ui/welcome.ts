/**
 * Welcome screen: the one place a run's seeding is chosen.
 *
 * It is not a first-load splash but a picker that can be reopened. `重新投放`
 * (R) re-drops the animals with the settings already in force, and this screen
 * is how those settings change, so a run is never stuck with the era or the
 * reproduction mode it happened to start with.
 *
 * That is why the component returns a handle rather than hiding itself once:
 * the picker used to be shown at load, hidden on start and never seen again,
 * which left the mode frozen for the life of the page even though the overlay
 * was still sitting in the DOM with a mode card highlighted.
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

export interface PickerSelection {
    era: EraConfig | undefined;
    mode: ReproductionMode;
}

/** What the picker should open on, given what is (or was last) running. */
export interface WelcomeCurrent {
    era?: EraConfig;
    reproduction?: ReproductionMode;
}

/**
 * Resolve the current run's settings into cards the picker can actually show.
 *
 * Both fall back rather than demand: a run seeded with no era has no card to
 * preselect, and a mode that a later change removed from the list (the mixed
 * mode was one) must not leave the picker with nothing selected. Matching the
 * era by name keeps this working across the config objects a restart makes.
 */
export function preselect(
    eras: ReadonlyArray<EraConfig>,
    current: WelcomeCurrent = {},
): PickerSelection {
    const era = eras.find((eraItem) => eraItem.name === current.era?.name) ?? eras[0];
    const mode = REPRODUCTION_MODES.find((modeItem) => modeItem.mode === current.reproduction)?.mode;
    return { era, mode: mode ?? REPRODUCTION_MODES[0].mode };
}

export interface Welcome {
    /** Open the picker, preselecting what is currently running. */
    show(current?: WelcomeCurrent): void;
    /** True while the picker is open and therefore owns the keyboard. */
    isOpen(): boolean;
}

export function createWelcome(
    container: HTMLElement,
    onStart: (era: EraConfig | undefined, reproduction: ReproductionMode) => void,
    eras: ReadonlyArray<EraConfig>,
): Welcome {
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
    let open = false;
    const modeDescEl = el.querySelector<HTMLElement>("#mode-desc");
    const modeButtons = el.querySelectorAll<HTMLButtonElement>(".mode-card");
    const cards = el.querySelectorAll<HTMLButtonElement>(".era-card");

    const showModeDesc = (): void => {
        if (!modeDescEl) return;
        modeDescEl.textContent =
            REPRODUCTION_MODES.find((modeItem) => modeItem.mode === selectedMode)?.desc ?? "";
    };
    /** Repaint both groups from the selection, so state and screen agree. */
    const render = (): void => {
        for (const button of modeButtons) {
            button.classList.toggle("on", button.dataset["mode"] === selectedMode);
        }
        for (const card of cards) {
            card.classList.toggle("era-selected", card.dataset["era"] === selectedEra?.name);
        }
        showModeDesc();
    };

    for (const button of modeButtons) {
        button.addEventListener("click", () => {
            const mode = button.dataset["mode"];
            if (mode) {
                selectedMode = mode as ReproductionMode;
                render();
            }
        });
    }
    for (const card of cards) {
        card.addEventListener("click", () => {
            const eraName = card.dataset["era"];
            if (eraName) {
                selectedEra = eras.find((eraItem) => eraItem.name === eraName) ?? eras[0];
                render();
            }
        });
    }

    /**
     * Enter or Space starts with the current selection. Registered only while
     * the picker is open: it used to be attached at construction and removed
     * only by dismissing itself, so clicking 開始觀察 left it listening, and the
     * next Space press — meant to pause the run — re-seeded the world instead.
     */
    const dismiss = (event: KeyboardEvent): void => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            start();
        }
    };

    function start(): void {
        const era = selectedEra;
        const mode = selectedMode;
        close();
        onStart(era, mode);
    }

    function close(): void {
        el.hidden = true;
        open = false;
        window.removeEventListener("keydown", dismiss);
    }

    const startButton = el.querySelector<HTMLButtonElement>("#welcome-start");
    if (startButton) {
        startButton.addEventListener("click", () => start());
    }

    return {
        show(current: WelcomeCurrent = {}): void {
            const pick = preselect(eras, current);
            selectedEra = pick.era;
            selectedMode = pick.mode;
            render();
            el.hidden = false;
            open = true;
            // Remove first so a second show() cannot stack listeners.
            window.removeEventListener("keydown", dismiss);
            window.addEventListener("keydown", dismiss);
        },
        isOpen(): boolean {
            return open;
        },
    };
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
