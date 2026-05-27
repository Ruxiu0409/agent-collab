![agent-collab cover](./assets/agent-collab-cover.svg)

# agent-collab

[English](./README.md) · [繁體中文](./README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-111827.svg)](./LICENSE)
[![CI](https://github.com/Ruxiu0409/agent-collab/actions/workflows/ci.yml/badge.svg)](https://github.com/Ruxiu0409/agent-collab/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.6-339933.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-MVP-0F766E.svg)](https://github.com/Ruxiu0409/agent-collab)

一個小巧的 AGENTS.md companion，讓 coding agents 在修改共享程式碼之前，先宣告自己的工作意圖。

避免 Codex、Claude Code、Cursor、Gemini CLI 和其他 coding agents 在同一個 repo 裡，默默根據過期上下文改壞彼此的成果。`agent-collab` 會在你的專案中安裝一套文件優先的 preflight protocol：每個 agent 在動程式碼之前，都要先寫下自己打算碰哪些檔案和區域。

它不取代 Git、不鎖檔，也不承諾完全防止衝突。它做的是讓即將發生的修改提早被看見，讓重疊工作在造成破壞之前先被提出來。

```bash
npx agent-collab init
```

## 為什麼需要 agent-collab

多個 coding agents 一起工作很方便，直到它們開始拿著不同時間點的程式碼記憶，去修改同一個專案。

典型狀況：

1. Agent A 讀了 `src/auth.ts`。
2. Agent B 也讀了同一份舊版本。
3. Agent A 更新了檔案。
4. Agent B 之後根據過期上下文寫入，意外把 A 的修改蓋掉或改壞。

Git 可以在事後告訴你發生了什麼，但它不會要求 agents 在修改前先宣告意圖。`agent-collab` 補上的就是這個 preflight 步驟。

## 特色

### 文件優先的 preflight

Agents 必須先閱讀 protocol、檢查 active work、執行 `git status --short`、重新讀取打算修改的檔案，並建立 intent，才可以開始改程式碼。

### JSON metadata，Markdown plan

每個 active intent 都是一個小資料夾：

```txt
.agent-collab/active/<intent-id>/
  intent.json
  plan.md
```

`intent.json` 給 CLI 穩定讀取。`plan.md` 則讓 agents 寫詳細計畫、驗證方式和交接備註。

### 提前提示潛在衝突

`agent-collab status` 會比較所有 active intents 的 planned files 和 affected areas。當工作內容重疊時，它會回報 potential conflict，並要求 agent 在修改前先停下來詢問使用者。

### stale intent 提醒

每個 intent 都有 `updated` 和 `expires` timestamp。`status` 和 `doctor` 會提示 stale 或 expired 的工作，避免舊的 coordination files 慢慢變成沒人信任的噪音。

### 原生支援 AGENTS.md

`agent-collab init` 會在 `AGENTS.md` 加入 managed section。AGENTS.md 是許多 coding agents 已經會讀取的跨工具指令檔。

## 快速開始

```bash
npx agent-collab init
```

## 安裝層級

`agent-collab` 預設從 lite setup 開始，更強的整合都必須明確 opt in：

| 層級 | 指令 | 會寫入或設定 |
| --- | --- | --- |
| Lite | `agent-collab init` | `AGENTS.md` 指引，加上 `.agent-collab/protocol.md`、`active/` 和 `archive/`。 |
| Hooks | `agent-collab init --hooks` | Lite 的所有內容，再加上 managed Git `pre-commit` hook，執行 `agent-collab check-staged`。 |
| MCP setup | `agent-collab init --mcp` | Lite 的所有內容，再加上 `.agent-collab/mcp.md`，提供 MCP integrations 的 tool-mapping guidance。 |

這些模式都是 additive 且 opt-in。預設 `init` 不會安裝 hooks、daemons、background services 或 MCP servers。

修改程式碼前先建立 intent：

```bash
agent-collab start \
  --agent codex \
  --title "Login validation" \
  --files src/login.ts,test/login.test.ts \
  --areas auth,login
```

查看目前工作狀態：

```bash
agent-collab status
agent-collab doctor
```

給自動化流程使用 JSON 輸出：

```bash
agent-collab status --json
agent-collab doctor --json
```

`status --json` 會輸出：

```json
{
  "intents": [],
  "overlaps": [],
  "problems": []
}
```

每個 intent 都包含相同的 `intent.json` metadata，另外加上 `id`、`path`、`stale`、`expired` 和 `ageMs`。`overlaps` 會列出 active intents 之間重疊的 `files` 或 `areas`。

`doctor --json` 會輸出：

```json
{
  "ok": true,
  "problems": [],
  "warnings": []
}
```

選擇性安裝 pre-commit hook：

```bash
agent-collab install-hooks
```

這個 hook 會在每次 commit 前執行 `agent-collab check-staged`。如果 staged files 沒有出現在任何 active intent 裡，或同一個 staged file 被多個 active intents 宣告，它會擋下 commit。若這次重疊是刻意的，可以用 `git commit --no-verify` 透過 Git 標準方式略過。

完成後封存 intent：

```bash
agent-collab done .agent-collab/active/<intent-id>
```

## 工作流程

```txt
agent-collab init
        |
        v
Agent reads AGENTS.md + .agent-collab/protocol.md
        |
        v
Agent checks active intents + git status
        |
        v
agent-collab start --files ... --areas ...
        |
        v
Edit code, verify, update handoff notes
        |
        v
agent-collab done .agent-collab/active/<intent-id>
```

## intent 範例

```json
{
  "schemaVersion": 1,
  "status": "active",
  "agent": "codex",
  "title": "Login validation",
  "started": "2026-05-26T06:30:00.000Z",
  "updated": "2026-05-26T06:30:00.000Z",
  "expires": "2026-05-26T10:30:00.000Z",
  "filesPlanned": ["src/login.ts", "test/login.test.ts"],
  "areasAffected": ["auth", "login"],
  "conflictCheck": {
    "checkedAt": "2026-05-26T06:30:00.000Z",
    "result": "no-conflict",
    "notes": "No active work touches the same files or affected areas."
  },
  "completion": {
    "changedFiles": [],
    "verificationRun": [],
    "handoffNotes": ""
  }
}
```

## 指令

| 指令 | 用途 |
| --- | --- |
| `agent-collab init` | 安裝 `AGENTS.md` 指引與 `.agent-collab/` protocol files。 |
| `agent-collab init --hooks` | 安裝 lite setup 和 opt-in pre-commit hook。 |
| `agent-collab init --mcp` | 安裝 lite setup，並寫入選擇性的 MCP setup guidance。 |
| `agent-collab start` | 建立包含 `intent.json` 和 `plan.md` 的 active intent directory。 |
| `agent-collab status` | 列出 active intents、stale work 和 potential overlaps。 |
| `agent-collab status --json` | 以穩定 JSON 輸出 status report，供 agents、CI 和 integrations 使用。 |
| `agent-collab doctor` | 檢查 setup、JSON intent files、git state 和 stale intents。 |
| `agent-collab doctor --json` | 以穩定 JSON 輸出 doctor report，供 agents、CI 和 integrations 使用。 |
| `agent-collab install-hooks` | 安裝選擇性的 pre-commit hook，檢查 staged files 是否有 intent 覆蓋。 |
| `agent-collab check-staged` | 將 staged files 與 active intents 比對；供 pre-commit hook 使用。 |
| `agent-collab done` | 將完成的工作從 `active/` 移到 `archive/`。 |

## Repo 結構

| 路徑 | 說明 |
| --- | --- |
| `src/core.ts` | `init`、`start`、`status`、`doctor`、`done` 的核心 protocol logic。 |
| `src/cli.ts` | 零外部依賴的 Node CLI entrypoint。 |
| `test/core.test.ts` | 使用 Node built-in test runner 的 MVP 行為測試。 |

## 開發

```bash
npm test
npm run check
node src/cli.ts --help
```

這個專案目前使用 Node 內建的 TypeScript type stripping 和 built-in test runner，所以 MVP 沒有 runtime dependencies。

## 定位

`agent-collab` 不是 task board、project manager、background daemon，也不是 agent orchestration runtime。

它是一個 coding-agent preflight protocol：小到可以直接放進 Git，清楚到人類可以 review，結構化到 CLI 可以在 agents 快要踩到彼此工作前提出警告。

## 授權

MIT
