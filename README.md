# agent-collab

A tiny AGENTS.md companion that makes coding agents declare intent before editing shared code.

`agent-collab` installs a document-first preflight protocol for repositories where multiple AI coding agents may work at the same time. It does not fully prevent conflicts or replace Git. It reduces stale-agent overwrites by making planned edits visible before code changes begin.

## Why

Two agents can read the same old file, then one agent edits it while the other later writes from stale context. Git can show the damage afterward, but it does not make agents declare intent before editing.

`agent-collab` adds a small coordination layer:

- `AGENTS.md` tells agents to follow the preflight protocol.
- `.agent-collab/protocol.md` explains the workflow.
- `.agent-collab/active/<intent-id>/intent.json` stores machine-readable metadata.
- `.agent-collab/active/<intent-id>/plan.md` stores the human-readable plan.

## Install

Use it directly with npm:

```bash
npx agent-collab init
```

For local development in this repository:

```bash
npm test
node src/cli.ts --help
```

## Commands

```bash
agent-collab init
agent-collab start --agent codex --title "Login validation" --files src/login.ts,test/login.test.ts --areas auth,login
agent-collab status
agent-collab doctor
agent-collab done .agent-collab/active/<intent-id>
```

## Intent Format

Each active intent is a directory:

```txt
.agent-collab/active/<intent-id>/
  intent.json
  plan.md
```

`intent.json` is the CLI's source of truth:

```json
{
  "schemaVersion": 1,
  "status": "active",
  "agent": "codex",
  "title": "Login validation",
  "started": "2026-05-26T06:30:00.000Z",
  "updated": "2026-05-26T06:30:00.000Z",
  "expires": "2026-05-26T10:30:00.000Z",
  "filesPlanned": ["src/login.ts"],
  "areasAffected": ["auth", "login"],
  "completion": {
    "changedFiles": [],
    "verificationRun": [],
    "handoffNotes": ""
  }
}
```

`plan.md` is where agents write detailed implementation steps, verification notes, and handoff context.

## Positioning

This is not a task board and not an orchestration runtime. It is a coding-agent preflight protocol that can live beside tools such as AGENTS.md, Git worktrees, and task trackers.

## License

MIT
