# 專案貢獻指南 (Contributing Guide)

感謝您對 **演化觀察者 (Evolution Observer)** 的貢獻！本專案是一個以 Three.js 呈現的 3D 生態演化模擬遊戲：食肉與食草動物各自擁有可演化的神經網路大腦，會隨時代與環境調整行為，以維持族群存續與繁衍。為維持程式庫之高品質與可維護性，本專案採用嚴格的 Commit 與 Pull Request 規範。

專案定位、架構與操作方式請見 [README](README.md)。

---

## 如何貢獻 (How to Contribute)

歡迎任何貢獻！本專案提供兩種方式：

1. **加入 Collaborator**：聯繫專案維護者取得 collaborator 權限後，可直接建立分支、推送變更並發起 PR。
2. **Fork & PR**：Fork 專案後從自己的 repo 發起 PR，由維護者審查合併。

---

## 分支規範 (Branch Rules)（僅 Collaborator）

> 以下規範僅限已取得 collaborator 權限的成員。Fork 貢獻者請直接從 Fork 發起 PR。

- `main` 分支必須隨時保持可部署狀態。
- 嚴禁直接 Push 至 `main` 分支。
- 依任務類型從 `main` 切出短期分支：
  - `feature/<short-name>`：新功能開發
  - `fix/<short-name>`：Bug 修復
  - `docs/<short-name>`：文件撰寫與維護
  - `style/<short-name>`：UI 樣式與排版調整
  - `chore/<short-name>`：相依套件與工程維護

### 串接 PR 工作流程 (Chained / Stacked PRs)

當一批功能需要依序合入時，採用 **rolling rebase** 策略，而非將所有分支都堆在同一個長分支上：

```
main ──▶ merge PR #1 ──▶ merge PR #2 ──▶ merge PR #N
              ↑                ↑                ↑
     feature/foo     feature/bar      feature/baz
```

**操作步驟（每一輪）**：

1. 前一個 PR 合併進 `main` 後，立即拉取最新遠端：
   ```bash
   git fetch origin
   ```
2. 將下一個功能分支 rebase 至最新的 `origin/main`：
   ```bash
   git rebase origin/main feature/<next-name>
   ```
3. 確認本地通過所有檢查後再 push 並開 PR：
   ```bash
   npm run typecheck && npm run test:policy && npm test
   git push --force-with-lease origin feature/<next-name>
   ```
4. 在 GitHub 上將 PR 的 **base branch 設為 `main`**（不要設為前一個功能分支）。

> [!IMPORTANT]
> Rebase 後必須使用 `--force-with-lease` 而非 `--force`，以防意外覆蓋他人推送。

---

## 提交訊息格式 (Commit Format)

> ⚠️ **重要**：雖然專案文件以繁體中文撰寫，但 **所有 Commit 訊息與 PR 標題必須使用英文**，並嚴格遵循 [Commit 與 PR 規範](docs/engineering/commit-policy.md)。

格式範例：
```text
feat(app): give carnivores an evolvable hunting brain
```

允許的 Type、Scope、字數限制與 Body 編號清單格式皆唯一定義於規範文件與 `scripts/commit-policy.mjs`。

---

## 原子化 Commit 原則 (Atomic Commits)

每次 Commit 僅能代表一個獨立邏輯變更：
- 分離無關功能的修改。
- 分離 Refactor 重構與功能行為變更。
- 檔案重新命名或移動一律使用 `git mv` 以保留 Git 歷史。

---

## Pull Request 流程

- PR 標題遵守與 Commit 相同之英文格式。
- 請使用 [`.github/pull_request_template.md`](.github/pull_request_template.md) 提供的範本填寫 PR 描述與驗證結果。
- 發起 PR 前請確保本地執行 `npm test`、`npm run typecheck`、`npm run test:policy` 與 `npm run test:docs` 通過。

---

## 隱私與資安防護

- 嚴禁提交真實個人資料、玩家存檔或模擬紀錄中的可識別資訊，以及任何 API 憑證。
- 測試資料與 Mock Fixture 必須全面使用去識別化之合成資料。
