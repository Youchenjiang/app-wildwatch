# 演化觀察者 (Evolution Observer)

以**上帝視角**觀察各種會**自我學習、自我演化**的 NPC 之 3D 演化模擬遊戲。

食肉動物與食草動物會根據當下時代與環境，持續調整自身的行為與策略，以維持種族存續與繁衍。本專案已加入三種場景（**草原、冰河、沙漠**）供開局選擇，並將逐步加入時代變遷時間軸、可演化的神經網路大腦、終身學習，以及回合快照、演化圖表、譜系樹與完整存檔機制。

## 四層演化智慧架構 (Intelligence Architecture)

遵循「**塵歸塵，土歸土；個體生滅，天道永存**」核心哲學：
1. **個體智能（Individual）**：每個 NPC 擁有可演化的類神經網路大腦（Tanh MLP）與情境回憶。
2. **親代傳承（Pedigree）**：幼獸出生時為白紙，透過緊隨母體並以行為複製（Behavior Cloning 反向傳播）模仿親代覓食與掠食。
3. **族群動態（Collective）**：透過社會信號網（`SocialSignalGrid`）實現草食動物恐慌警報廣播與肉食動物捕殺血跡追蹤，支援孤狼至群居的連續光譜。
4. **天道宏觀（God Agent & Metacognition）**：老天爺代理人監控生態平衡與瀕危警戒，並將歷代最強個體大腦歸檔為「神聖種子（Sacred Seeds）」。只有老天爺記憶持久化保存於 GitHub Pages，供下一紀元投放時繼承原型。

## 架構

- **模擬維持 2D 平面**（`src/sim/`）——碰撞與鄰近搜尋使用 2D 空間雜湊，純邏輯、零渲染依賴，可完整單元測試。
- **3D 僅為視覺層**（`src/render/`）——Three.js 上帝視角場景，把 2D 世界投射為 3D 呈現。
- **場景（時代）預設**（`src/sim/era.ts`）宣告每個時代的外觀、物種參數、植被週期與初始數量；`World` 在投放時解析成鎖定的 `WorldConfig`，同一局內不再變動。
- **神聖記憶持久化**（`public/data/god-memory.json`）——靜態 JSON 發布於 GitHub Pages，純前端自動讀取並可隨時匯出最新訓練成果。

## 運行

```bash
npm install          # 安裝依賴並安裝 Git hooks（prepare）
npm run dev          # 開發伺服器 http://127.0.0.1:5173
```

操作：開局在歡迎畫面選擇場景（草原／冰河／沙漠）後開始觀察。`空白鍵` 暫停 · `+`/`-` 調整模擬速度 · `R` 重設世界。

## 驗證

```bash
npm run typecheck    # TypeScript 型別檢查
npm test             # Vitest 單元測試
npm run build        # 生產建置
npm run test:policy  # Commit/PR 規範自我測試
npm run test:docs    # 文件完整性檢查
```

## 工程規範

Commit 與 PR 規則、AI Agent 行為準則、貢獻指南見 `AGENTS.md`、`CONTRIBUTING.md` 與 `docs/engineering/commit-policy.md`。