# Agent Collab Design

## Summary

`agent-collab` is a TypeScript/Node CLI that installs a document-first coordination protocol for multiple AI coding agents working in the same Git repository.

The project does not try to replace Git, AGENTS.md, or full multi-agent orchestration platforms. Instead, it adds a lightweight preflight layer: before an agent edits code, it must declare its intent in a project-local Markdown file, check active work from other agents, and stop if its planned files or affected areas conflict.

## Problem

When two AI coding agents work in the same repository, they can overwrite or undo each other's changes because each agent may be acting from stale context. The common failure mode is:

1. Agent A reads a file and prepares a change.
2. Agent B reads the same old version.
3. Agent A edits the file.
4. Agent B edits from stale context and accidentally reverts or corrupts Agent A's work.

Git helps after the fact, but it does not force agents to state intent before editing. Worktrees reduce file-level collision, but they do not solve coordination around shared logic, overlapping features, or stale assumptions.

## Product Positioning

`agent-collab` is an AGENTS.md companion for document-first coding-agent coordination.

It is intentionally narrower than a task manager or orchestration framework:

- AGENTS.md remains the standard place for agent instructions.
- `agent-collab` installs AGENTS.md rules that require a preflight workflow.
- Active work is represented as small Markdown intent files.
- The CLI helps create, inspect, validate, and archive those intent files.

## Goals

- Make multi-agent coding safer without requiring a server, database, or editor plugin.
- Require every agent to document its plan before editing code.
- Make potential conflicts visible before code changes begin.
- Work across Codex, Claude Code, Cursor, Gemini CLI, Copilot, and other tools that can read Markdown.
- Keep the workflow understandable for humans reviewing a repository.

## Non-Goals

- No hard filesystem locking in the MVP.
- No automatic conflict resolution in the MVP.
- No full task board or project management system.
- No model-specific orchestration runtime.
- No background daemon.

## File Layout

After running `npx agent-collab init`, the project contains:

```txt
AGENTS.md
.agent-collab/
  protocol.md
  active/
  archive/
```

Optional tool-specific files can be generated later, but the MVP should prefer AGENTS.md as the cross-tool instruction surface.

## Core Protocol

Before editing code, every agent must:

1. Read `AGENTS.md`.
2. Read `.agent-collab/protocol.md`.
3. Inspect `.agent-collab/active/*.md`.
4. Run `git status --short`.
5. Re-read every file it plans to edit.
6. Check whether any active intent overlaps by file path, component, feature area, or test surface.
7. If a conflict exists, stop and report it to the user.
8. If no conflict exists, create a new active intent file.
9. Only after the intent file exists may the agent edit code.
10. Before finishing, update the intent file with changed files, verification, and handoff notes.

## Active Intent File

Each active intent is a separate Markdown file to avoid agents competing over a single shared ledger.

Example path:

```txt
.agent-collab/active/2026-05-26T1430-codex-login-validation.md
```

Example content:

```md
# Work Intent: Login Validation Refactor

Status: active
Agent: codex
Started: 2026-05-26T14:30:00+08:00

## Goal

Refactor login validation so invalid credentials show localized error messages.

## Files Planned

- Sources/Auth/LoginView.swift
- Sources/Auth/LoginValidator.swift
- Tests/Auth/LoginValidatorTests.swift

## Areas Affected

- Login form validation
- Auth error display
- Auth unit tests

## Conflict Check

Checked active intents before starting. No active work touches the same files or affected areas.

## Plan

1. Read current LoginView and LoginValidator implementations.
2. Add a validation result type.
3. Update UI error rendering.
4. Add unit tests for empty password and invalid email.

## Verification Plan

- Run LoginValidatorTests.
- Build the app target if available.

## Completion

Status: pending
Changed files: pending
Verification run: pending
Handoff notes: pending
```

## CLI Commands

### `agent-collab init`

Creates the protocol files and adds AGENTS.md instructions.

Behavior:

- If AGENTS.md does not exist, create one with the document-first protocol.
- If AGENTS.md exists, append a managed `agent-collab` section with clear markers.
- Create `.agent-collab/protocol.md`.
- Create `.agent-collab/active/` and `.agent-collab/archive/`.

### `agent-collab start`

Creates a new active intent file.

Initial MVP can support flags:

```bash
agent-collab start \
  --agent codex \
  --title "Login validation refactor" \
  --files Sources/Auth/LoginView.swift,Sources/Auth/LoginValidator.swift \
  --areas "login validation,auth errors"
```

If flags are omitted, the CLI can print a template for the agent or human to fill in manually.

### `agent-collab status`

Reads all active intent files and prints:

- active work titles
- agents
- planned files
- affected areas
- likely overlaps

### `agent-collab doctor`

Checks whether the repository is configured correctly:

- AGENTS.md exists.
- `.agent-collab/protocol.md` exists.
- active and archive directories exist.
- AGENTS.md contains the managed preflight section.
- Git repository is present.
- Uncommitted changes are visible.

### `agent-collab done`

Archives an active intent after work is complete.

The MVP can keep this simple:

```bash
agent-collab done .agent-collab/active/2026-05-26T1430-codex-login-validation.md
```

It moves the file to `.agent-collab/archive/` after confirming the completion section is filled.

## Conflict Detection

The MVP uses conservative text-based detection:

- exact file path overlap
- parent directory overlap
- repeated area keywords
- dirty Git files overlapping with planned files

The CLI should report possible conflicts, not decide that work is impossible.

Example output:

```txt
Potential conflict:
- Your planned file Sources/Auth/LoginView.swift is already claimed by:
  .agent-collab/active/2026-05-26T1430-codex-login-validation.md

Stop and ask the user before editing.
```

## Update Strategy

Managed sections should use markers so the CLI can update its own content without overwriting user-authored guidance.

Example:

```md
<!-- agent-collab:start -->
...
<!-- agent-collab:end -->
```

The CLI must never rewrite unrelated AGENTS.md content.

## Risks

### Agent Compliance

Agents may ignore the protocol. The mitigation is to put concise, repeated instructions in AGENTS.md and make `agent-collab doctor` detect missing or stale instructions.

### Coordination File Conflicts

A single shared Markdown ledger would become a conflict hotspot. The design avoids this by giving every agent its own active intent file.

### Workflow Friction

Document-first workflows can feel heavy for tiny changes. The protocol should allow a "quick intent" for low-risk edits, but the MVP should still require an intent before code edits.

### False Conflict Reports

File and keyword overlap are imperfect. The CLI should phrase results as "potential conflicts" and ask agents to stop for user review rather than automatically blocking all work.

## Success Criteria

The MVP is successful when:

- A user can run `npx agent-collab init` in an existing repo.
- A coding agent reading AGENTS.md understands that it must create an intent before editing.
- Two active intent files with overlapping paths are reported by `agent-collab status`.
- `agent-collab doctor` catches missing protocol files and missing managed AGENTS.md instructions.
- The workflow remains plain Markdown and Git-friendly.

## Recommended MVP Decisions

- Use `agent-collab` as the working package and CLI name. It is plain, memorable, and broad enough for future commands.
- Make `agent-collab start` template-first in the first release. Interactive prompts can be added after the protocol format stabilizes.
- Keep tool-specific files such as `.cursor/rules` out of the MVP. Start with AGENTS.md because it is the broadest cross-tool surface.
