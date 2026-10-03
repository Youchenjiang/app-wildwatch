import { DEFAULT_TICKS_PER_SECOND, speedLabel } from "../observe/pacing";

/**
 * Observer control bar: pause, speed, replay review, camera reset, changing
 * the setup, ending the run.
 *
 * Almost everything here is a lens, per docs/game-rules.md "觀察者工具": it
 * changes what you see, never what the simulation does, and ending a run only
 * stops the loop. The exception is 換設定, which is not an observation at all —
 * it reopens the seeding picker, and the picker's start begins a *new* run.
 * Nothing about the run in progress is edited, which is what rule 2 requires.
 */
export interface ControlsCallbacks {
    onPauseToggle(): void;
    /** Step the speed ladder: -1 slower, +1 faster. */
    onSpeedChange(step: number): void;
    onReplayScrub(frameIndex: number): void;
    onReplayExit(): void;
    onCameraReset(): void;
    /** Reopen the seeding picker: scene and reproduction mode. */
    onChangeSetup(): void;
    /** Toggle the sandbox experiment panel for runtime modifications. */
    onToggleSandbox?(): void;
    onEndRun(): void;
}

export interface Controls {
    setPaused(paused: boolean): void;
    /** Show the current speed, in ticks per second. */
    setSpeed(ticksPerSecond: number): void;
    /** Show/hide the replay section of the bar. */
    setReplayVisible(visible: boolean, frameCount?: number): void;
    setReplayIndex(index: number, frameCount: number): void;
    /** True while the user is scrubbing a replay frame. */
    isReplaying(): boolean;
}

export function createControls(container: HTMLElement, callbacks: ControlsCallbacks): Controls {
    const bar = document.createElement("div");
    bar.id = "controls";
    bar.innerHTML = `
        <div class="ctl-row">
            <button id="ctl-pause" title="空白鍵">⏸ 暫停</button>
            <div class="ctl-speed">
                <button id="ctl-slower" title="減速（每秒 tick 數）">−</button>
                <span id="ctl-speed-label">${speedLabel(DEFAULT_TICKS_PER_SECOND)}</span>
                <button id="ctl-faster" title="加速（每秒 tick 數）">＋</button>
            </div>
            <span class="ctl-sep"></span>
            <button id="ctl-cam" title="重置視角">🎯 重置</button>
            <button id="ctl-setup" title="選擇場景與繁殖方式，重新投放">⚙ 換設定</button>
            <button id="ctl-sandbox" title="開啟沙盒實驗控制面板，進行運行中干預">🧪 沙盒</button>
            <button id="ctl-end" title="結束本局">⏹ 結束</button>
        </div>
        <div class="ctl-replay" id="ctl-replay" hidden>
            <button id="ctl-live">◀ 返回即時</button>
            <input id="ctl-scrub" type="range" min="0" max="0" value="0" step="1" />
            <span id="ctl-frame-label">0 / 0</span>
        </div>
    `;
    container.appendChild(bar);

    const findElement = <ElementType extends HTMLElement>(selector: string): ElementType => {
        const element = bar.querySelector<ElementType>(selector);
        if (!element) {
            throw new Error(`Element not found: ${selector}`);
        }
        return element;
    };
    const pauseBtn = findElement<HTMLButtonElement>("#ctl-pause");
    const speedLabelEl = findElement<HTMLElement>("#ctl-speed-label");
    const replayBox = findElement<HTMLElement>("#ctl-replay");
    const scrub = findElement<HTMLInputElement>("#ctl-scrub");
    const frameLabel = findElement<HTMLElement>("#ctl-frame-label");
    const liveBtn = findElement<HTMLButtonElement>("#ctl-live");
    let replaying = false;

    pauseBtn.addEventListener("click", () => callbacks.onPauseToggle());
    findElement<HTMLButtonElement>("#ctl-slower").addEventListener("click", () => callbacks.onSpeedChange(-1));
    findElement<HTMLButtonElement>("#ctl-faster").addEventListener("click", () => callbacks.onSpeedChange(1));
    findElement<HTMLButtonElement>("#ctl-cam").addEventListener("click", () => callbacks.onCameraReset());
    findElement<HTMLButtonElement>("#ctl-setup").addEventListener("click", () => callbacks.onChangeSetup());
    findElement<HTMLButtonElement>("#ctl-sandbox").addEventListener("click", () => callbacks.onToggleSandbox?.());
    findElement<HTMLButtonElement>("#ctl-end").addEventListener("click", () => callbacks.onEndRun());
    liveBtn.addEventListener("click", () => {
        replaying = false;
        replayBox.hidden = true;
        callbacks.onReplayExit();
    });
    scrub.addEventListener("input", () => {
        replaying = true;
        callbacks.onReplayScrub(Number(scrub.value));
    });

    return {
        setPaused(paused: boolean): void {
            pauseBtn.textContent = paused ? "▶ 繼續" : "⏸ 暫停";
        },
        setSpeed(ticksPerSecond: number): void {
            speedLabelEl.textContent = speedLabel(ticksPerSecond);
        },
        setReplayVisible(visible: boolean, frameCount = 0): void {
            const wasHidden = replayBox.hidden;
            replayBox.hidden = !visible;
            if (visible) {
                scrub.max = String(Math.max(0, frameCount - 1));
                // Initialize the thumb only when the row first appears; the
                // frame loop drives it afterwards via setReplayIndex.
                if (wasHidden && !replaying) {
                    scrub.value = scrub.max;
                    frameLabel.textContent = `${frameCount} / ${frameCount}`;
                }
            }
        },
        setReplayIndex(index: number, frameCount: number): void {
            scrub.value = String(index);
            frameLabel.textContent = `${index + 1} / ${frameCount}`;
        },
        isReplaying(): boolean {
            return replaying;
        },
    };
}
