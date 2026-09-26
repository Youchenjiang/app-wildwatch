# 演化觀察者 (Evolution Observer)

以**上帝視角**觀察各種會**自我學習、自我演化**的 NPC 之 3D 演化模擬遊戲。

食肉動物與食草動物會根據當下時代與環境，持續調整自身的行為與策略，以維持種族存續與繁衍。本專案將逐步加入多種場景（草原、冰河、沙漠）、時代變遷時間軸、可演化的神經網路大腦、終身學習，以及回合快照、演化圖表、譜系樹與完整存檔機制。

## 架構

- **模擬維持 2D 平面**（`src/sim/`）——碰撞與鄰近搜尋使用 2D 空間雜湊，純邏輯、零渲染依賴，可完整單元測試。
- **3D 僅為視覺層**（`src/render/`）——Three.js 上帝視角場景，把 2D 世界投射為 3D 呈現。
- 每個 NPC 有一個**可演化的神經網路大腦**（`src/sim/brain.ts`），基因組 = 網路權重，繁殖時帶突變。
- 每回合（`turnLength` ticks）記錄一次種群快照（`world.records`），作為演化圖表與紀錄機制的資料來源。

## 運行

```bash
npm install          # 安裝依賴並安裝 Git hooks（prepare）
npm run dev          # 開發伺服器 http://127.0.0.1:5173
```

操作：`空白鍵` 暫停 · `+`/`-` 調整模擬速度 · `R` 重設世界。

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