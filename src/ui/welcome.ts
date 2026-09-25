/**
 * Welcome screen shown on first load. Gives the player a brief orientation
 * before the simulation starts.
 */
export function createWelcome(container: HTMLElement, onStart: () => void): void {
    const el = document.createElement("div");
    el.id = "welcome";
    el.innerHTML = `
        <div class="welcome-icon">🧬</div>
        <div class="welcome-title">演化觀察者</div>
        <div class="welcome-sub">
            觀察<em>草食</em>與<em>肉食</em>物種在封閉草原上的生存競爭。
            <b>點擊個體</b>可查看其狀態與記憶。
            季節循環帶來環境壓力——留意種群的起伏。
        </div>
        <button id="welcome-start">開始觀察</button>
        <div class="welcome-keys">空白鍵 暫停 · +/− 速度 · R 重新投放</div>
    `;
    container.appendChild(el);

    el.querySelector<HTMLButtonElement>("#welcome-start")!.addEventListener("click", () => {
        el.hidden = true;
        onStart();
    });

    // Also dismiss on any key
    const dismiss = (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            el.hidden = true;
            onStart();
            window.removeEventListener("keydown", dismiss);
        }
    };
    window.addEventListener("keydown", dismiss);
}
