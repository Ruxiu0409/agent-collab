# Agent Collab MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish the first working `agent-collab` CLI MVP from the approved design spec.

**Architecture:** A zero-dependency TypeScript Node CLI exposes `init`, `start`, `status`, `doctor`, and `done`. The CLI writes AGENTS.md managed instructions, `.agent-collab/protocol.md`, and per-intent directories containing `intent.json` plus `plan.md`; all coordination metadata is parsed from JSON.

**Tech Stack:** Node.js 26, TypeScript files executed with Node type stripping, Node built-in test runner, GitHub CLI for publishing.

---

### Task 1: Project Scaffold And Red Tests

**Files:**
- Create: `package.json`
- Create: `src/core.ts`
- Create: `src/cli.ts`
- Create: `test/core.test.ts`
- Create: `.gitignore`

- [ ] **Step 1: Add package metadata and test script**

Create `package.json` with:

```json
{
  "name": "agent-collab",
  "version": "0.1.0",
  "description": "A tiny AGENTS.md companion that makes coding agents declare intent before editing shared code.",
  "type": "module",
  "bin": {
    "agent-collab": "./src/cli.ts"
  },
  "scripts": {
    "test": "node --test test/*.test.ts",
    "check": "node --check src/cli.ts"
  },
  "engines": {
    "node": ">=22.6"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Write failing tests for init, start, status, doctor, and done**

Create `test/core.test.ts` using Node's built-in test runner. Tests import functions from `src/core.ts`, use temporary directories, and assert that:

- `initProject()` creates AGENTS.md, `.agent-collab/protocol.md`, active, and archive directories.
- `startIntent()` creates an intent directory with valid `intent.json` and `plan.md`.
- `getStatus()` reports file path overlaps and stale intents.
- `doctorProject()` reports malformed `intent.json`.
- `doneIntent()` archives an intent directory.

- [ ] **Step 3: Add empty source placeholders**

Create `src/core.ts` and `src/cli.ts` with no exported behavior yet so tests fail on missing exports.

- [ ] **Step 4: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because implementation functions are missing or return no behavior.

### Task 2: Core Library

**Files:**
- Modify: `src/core.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Implement core file operations**

Implement:

- `initProject(root)`
- `startIntent(root, options)`
- `getStatus(root, now)`
- `doctorProject(root, now)`
- `doneIntent(root, intentPath)`

Use only Node built-ins: `node:fs/promises`, `node:path`, and `node:child_process`.

- [ ] **Step 2: Run tests and verify GREEN**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Refactor for focused helpers**

Keep helper functions small:

- `readIntent()`
- `validateIntent()`
- `slugify()`
- `formatProtocol()`
- `formatAgentsSection()`

- [ ] **Step 4: Run tests again**

Run: `npm test`

Expected: PASS.

### Task 3: CLI Entrypoint And Docs

**Files:**
- Modify: `src/cli.ts`
- Create: `README.md`
- Create: `LICENSE`
- Modify: `package.json`

- [ ] **Step 1: Implement CLI argument parsing**

Support:

```bash
agent-collab init
agent-collab start --agent codex --title "Login validation" --files src/a.ts,src/b.ts --areas auth,login
agent-collab status
agent-collab doctor
agent-collab done .agent-collab/active/<intent-id>
```

- [ ] **Step 2: Write README**

README first screen must use the positioning line:

> A tiny AGENTS.md companion that makes coding agents declare intent before editing shared code.

It must say the tool reduces or surfaces conflicts, not fully prevents them.

- [ ] **Step 3: Add MIT license**

Create `LICENSE` with MIT terms.

- [ ] **Step 4: Run local verification**

Run:

```bash
npm test
npm run check
node src/cli.ts --help
```

Expected: all pass, help text prints supported commands.

### Task 4: Commit And Publish To GitHub

**Files:**
- All intended project files.

- [ ] **Step 1: Inspect final diff**

Run: `git status --short` and `git diff --stat`.

- [ ] **Step 2: Commit implementation**

Commit all intended files with message:

```bash
Implement agent-collab MVP
```

- [ ] **Step 3: Create or connect GitHub repository**

Use `gh auth status` to confirm authentication. If authenticated and no remote exists, create a public GitHub repo named `agent-collab` with `gh repo create agent-collab --public --source . --remote origin --push`.

- [ ] **Step 4: Verify GitHub publication**

Run `git remote -v` and `gh repo view --web` or `gh repo view --json nameWithOwner,url`.

Expected: repository URL is available and the branch is pushed.
