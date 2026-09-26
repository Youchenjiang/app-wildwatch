/**
 * Observer control bar: pause, speed, replay review, camera reset, ending
 * the run. Per docs/game-rules.md "觀察者工具", everything here is a lens —
 * none of it mutates the simulation (ending a run only stops the loop).
 */
export interface ControlsCallbacks {
    onPauseToggle(): void;
    onSpeedChange(tpf: number): void;
    onReplayScrub(frameIndex: number): void;
    onReplayExit(): void;
    onCameraReset(): void;
    onEndRun(): void;
}

export interface Controls {
    setPaused(paused: boolean): void;
    setSpeed(tpf: number): void;
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
            <button id="ctl-pause" title="空白鍵">⏸</button>
            <div class="ctl-speed">
                <button id="ctl-slower" title="-">−</button>
                <span id="ctl-speed-label">×10</span>
                <button id="ctl-faster" title="+">＋</button>
            </div>
            <span class="ctl-sep"></span>
            <button id="ctl-cam" title="Reset view">🎯</button>
            <button id="ctl-end" title="結束本局訓練">⏹ 結束本局</button>
        </div>
        <div class="ctl-replay" id="ctl-replay" hidden>
            <button id="ctl-live">返回即時</button>
            <input id="ctl-scrub" type="range" min="0" max="0" value="0" step="1" />
            <span id="ctl-frame-label">0 / 0</span>
        </div>
    `;
    container.appendChild(bar);

    const q = <T extends HTMLElement>(sel: string): T => bar.querySelector<T>(sel)!;
    const pauseBtn = q<HTMLButtonElement>("#ctl-pause");
    const speedLabel = q("#ctl-speed-label");
    const replayBox = q("#ctl-replay");
    const scrub = q<HTMLInputElement>("#ctl-scrub");
    const frameLabel = q("#ctl-frame-label");
    const liveBtn = q<HTMLButtonElement>("#ctl-live");
    let replaying = false;

    pauseBtn.addEventListener("click", () => callbacks.onPauseToggle());
    q("#ctl-slower").addEventListener("click", () => callbacks.onSpeedChange(-1));
    q("#ctl-faster").addEventListener("click", () => callbacks.onSpeedChange(1));
    q("#ctl-cam").addEventListener("click", () => callbacks.onCameraReset());
    q("#ctl-end").addEventListener("click", () => callbacks.onEndRun());
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
            pauseBtn.textContent = paused ? "▶" : "⏸";
        },
        setSpeed(tpf: number): void {
            speedLabel.textContent = `×${tpf}`;
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
