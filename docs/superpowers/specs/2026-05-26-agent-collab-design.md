# Agent Collab Design

## Summary

`agent-collab` is a TypeScript/Node CLI that installs a document-first coordination protocol for multiple AI coding agents working in the same Git repository.

The project does not try to replace Git, AGENTS.md, TICK.md, or full multi-agent orchestration platforms. Instead, it adds a lightweight preflight layer: before an agent edits code, it must declare its intent in a project-local intent directory, check active work from other agents, and stop if its planned files or affected areas conflict.

The product promise should be intentionally honest: `agent-collab` cannot guarantee that an agent will obey Markdown instructions, but it can make intended edits visible before code changes begin and reduce stale-agent overwrites.

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
- Active work is represented as small intent directories containing machine-readable JSON metadata and human-readable Markdown plans.
- The CLI helps create, inspect, validate, and archive those intent directories.

The primary positioning line for README and package metadata should be:

> A tiny AGENTS.md companion that makes coding agents declare intent before editing shared code.

This avoids competing directly with task-board protocols such as TICK.md. TICK.md coordinates tasks; `agent-collab` coordinates coding-agent preflight checks around planned edits, affected code areas, stale context, and handoff notes.

## Goals

- Make multi-agent coding safer without requiring a server, database, or editor plugin.
- Require every agent to document its plan before editing code.
- Make potential conflicts visible before code changes begin.
- Reduce stale-agent overwrites by requiring explicit intent before edits.
- Work across Codex, Claude Code, Cursor, Gemini CLI, Copilot, and other tools that can read project-local Markdown and JSON files.
- Keep the workflow understandable for humans reviewing a repository.

## Non-Goals

- No hard filesystem locking in the MVP.
- No claim that conflicts can be fully prevented.
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
    <intent-id>/
      intent.json
      plan.md
  archive/
```

Optional tool-specific files can be generated later, but the MVP should prefer AGENTS.md as the cross-tool instruction surface.

## Core Protocol

Before editing code, every agent must:

1. Read `AGENTS.md`.
2. Read `.agent-collab/protocol.md`.
3. Inspect `.agent-collab/active/*/intent.json` and `.agent-collab/active/*/plan.md`.
4. Run `git status --short`.
5. Re-read every file it plans to edit.
6. Check whether any active intent overlaps by file path, component, feature area, or test surface.
7. If a conflict exists, stop and report it to the user.
8. If no conflict exists, create a new active intent directory.
9. Only after `intent.json` and `plan.md` exist may the agent edit code.
10. Refresh `intent.json` and `plan.md` while working if the plan changes.
11. Before finishing, update the intent directory with changed files, verification, and handoff notes.
12. Run `agent-collab done` or manually move the completed intent to `.agent-collab/archive/`.

## Active Intent Directory

Each active intent is a separate directory to avoid agents competing over a single shared ledger and to keep machine data separate from long-form notes.

Example path:

```txt
.agent-collab/active/2026-05-26T1430-codex-login-validation/
  intent.json
  plan.md
```

Example `intent.json`:

```json
{
  "schemaVersion": 1,
  "status": "active",
  "agent": "codex",
  "title": "Login validation refactor",
  "started": "2026-05-26T14:30:00+08:00",
  "updated": "2026-05-26T14:30:00+08:00",
  "expires": "2026-05-26T18:30:00+08:00",
  "filesPlanned": [
    "Sources/Auth/LoginView.swift",
    "Sources/Auth/LoginValidator.swift",
    "Tests/Auth/LoginValidatorTests.swift"
  ],
  "areasAffected": [
    "login form validation",
    "auth error display",
    "auth unit tests"
  ],
  "conflictCheck": {
    "checkedAt": "2026-05-26T14:30:00+08:00",
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

Example `plan.md`:

```md
# Work Intent: Login Validation Refactor

## Goal

Refactor login validation so invalid credentials show localized error messages.

## Plan

1. Read current LoginView and LoginValidator implementations.
2. Add a validation result type.
3. Update UI error rendering.
4. Add unit tests for empty password and invalid email.

## Verification Plan

- Run LoginValidatorTests.
- Build the app target if available.

## Handoff Notes

None yet.
```

The CLI should treat `intent.json` as authoritative for status, file paths, affected areas, timestamps, and conflict checks. `plan.md` is for humans and agents to write detailed reasoning, implementation steps, verification notes, and handoff context.

## CLI Commands

### `agent-collab init`

Creates the protocol files and adds AGENTS.md instructions.

Behavior:

- If AGENTS.md does not exist, create one with the document-first protocol.
- If AGENTS.md exists, append a managed `agent-collab` section with clear markers.
- Create `.agent-collab/protocol.md`.
- Create `.agent-collab/active/` and `.agent-collab/archive/`.

### `agent-collab start`

Creates a new active intent directory with `intent.json` and `plan.md`.

Initial MVP can support flags:

```bash
agent-collab start \
  --agent codex \
  --title "Login validation refactor" \
  --files Sources/Auth/LoginView.swift,Sources/Auth/LoginValidator.swift \
  --areas "login validation,auth errors"
```

If flags are omitted, the CLI can print a template for the agent or human to fill in manually.

The MVP should write real files instead of only printing a template. A template-only mode can exist later, but the default path should create a valid JSON intent so agents do not skip the coordination step.

### `agent-collab status`

Reads all active intent directories and prints:

- active work titles
- agents
- planned files
- affected areas
- age and stale state
- likely overlaps

### `agent-collab doctor`

Checks whether the repository is configured correctly:

- AGENTS.md exists.
- `.agent-collab/protocol.md` exists.
- active and archive directories exist.
- AGENTS.md contains the managed preflight section.
- Active `intent.json` files are valid JSON and match schema version 1.
- Git repository is present.
- Uncommitted changes are visible.
- Active intents older than the stale threshold are reported.
- Expired intents are reported separately from merely stale intents.

### `agent-collab done`

Archives an active intent directory after work is complete.

The MVP can keep this simple:

```bash
agent-collab done .agent-collab/active/2026-05-26T1430-codex-login-validation
```

It moves the directory to `.agent-collab/archive/` after checking `intent.json` and warning if completion metadata is missing.

## Intent Lifecycle

Active intent directories are useful only while they represent current work. The MVP should treat stale active directories as a first-class problem.

Default lifecycle:

- `active`: current work, updated recently.
- `stale`: active work with no update for more than 4 hours.
- `expired`: active work whose `expires` timestamp has passed.
- `completed`: work finished and ready to archive.
- `archived`: completed work moved to `.agent-collab/archive/`.

`agent-collab status` should always show stale and expired intents with visible warnings:

```txt
Stale intent:
- .agent-collab/active/2026-05-26T1430-codex-login-validation
  Agent: codex
  Last updated: 5h 12m ago
  Planned files: Sources/Auth/LoginView.swift

Ask the user whether this work is still active before editing overlapping files.
```

`agent-collab doctor` should warn when active intents are stale. The first release should not fail, delete, or archive automatically.

The protocol should require every agent to refresh the `updated` field in `intent.json` when its plan changes or when it resumes a paused task. This keeps stale detection cheap and understandable.

## JSON Schema

`intent.json` should be the only source the CLI parses for coordination metadata. The MVP should include a versioned JSON Schema for `schemaVersion: 1`.

Required fields:

- `schemaVersion`
- `status`
- `agent`
- `title`
- `started`
- `updated`
- `expires`
- `filesPlanned`
- `areasAffected`
- `completion`

Validation rules:

- `status` must be one of `active`, `completed`, or `archived`.
- `filesPlanned` and `areasAffected` must be arrays of strings.
- `started`, `updated`, and `expires` must be ISO 8601 timestamps.
- `completion.changedFiles` and `completion.verificationRun` must be arrays.

The CLI should reject invalid JSON for commands that write or archive intents, and `doctor` should report invalid JSON without modifying it.

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
- Your planned file Sources/Auth/LoginView.swift is already listed by:
  .agent-collab/active/2026-05-26T1430-codex-login-validation/intent.json

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

Agents may ignore the protocol because Markdown instructions are not hard enforcement.

Solution:

- Make the README and AGENTS.md copy honest: the tool reduces stale-agent overwrites but does not guarantee prevention.
- Put the preflight rule in a short managed AGENTS.md section with imperative language: read active intents, create intent before editing, stop on overlap.
- Make `agent-collab doctor` detect missing, edited, or stale managed instructions.
- Make `agent-collab status` return copy-pastable warnings that agents can surface to users when work overlaps.
- Add an optional future `agent-collab guard` command only after the document-first protocol proves useful; do not include hard enforcement in the MVP.

Acceptance criteria:

- The generated AGENTS.md section tells agents they must not edit code before creating an active intent.
- The README says "reduce" or "surface" conflicts, not "prevent" conflicts.
- `doctor` reports a missing managed AGENTS.md section.

### Positioning Overlap With TICK.md

The project may look like another Markdown task manager.

Solution:

- Position `agent-collab` as a coding-agent preflight protocol, not a task board.
- Keep the MVP focused on planned files, affected areas, stale context, verification, and handoff notes.
- Avoid backlog, priority queues, dependencies, assignment workflows, dashboards, and hosted sync in the MVP.
- Explicitly state that it can be used alongside task tools: a TICK.md task can link to an `agent-collab` intent, but `agent-collab` does not own the task lifecycle.

Acceptance criteria:

- README first screen uses the phrase "declare intent before editing shared code."
- The design and generated docs avoid task-board language such as backlog, sprint, priority, and assignee.
- CLI commands remain `init`, `start`, `status`, `doctor`, and `done`; no `next`, `claim`, or `assign` in the MVP.

### Stale Active Intents

Agents may forget to archive completed work, causing `.agent-collab/active/` to become noisy and untrusted.

Solution:

- Add `updated` and `expires` fields to every `intent.json`.
- Treat intents as stale after 4 hours without an update.
- Treat intents as expired after the `expires` timestamp.
- Make `status` and `doctor` highlight stale and expired intents.
- Require `done` to archive completed intents.
- Never auto-delete active intents in the MVP; stale work should require human or agent confirmation.

Acceptance criteria:

- `agent-collab start` writes `started`, `updated`, and `expires`.
- `agent-collab status` labels stale and expired active intents.
- `agent-collab doctor` warns when stale or expired active intents exist.
- `agent-collab done` moves completed intent directories to `.agent-collab/archive/`.

### Coordination File Conflicts

A single shared Markdown ledger would become a conflict hotspot. The design avoids this by giving every agent its own active intent directory.

### Workflow Friction

Document-first workflows can feel heavy for tiny changes. The protocol should allow a "quick intent" for low-risk edits, but the MVP should still require an intent before code edits.

### False Conflict Reports

File and keyword overlap are imperfect. The CLI should phrase results as "potential conflicts" and ask agents to stop for user review rather than automatically blocking all work.

## Success Criteria

The MVP is successful when:

- A user can run `npx agent-collab init` in an existing repo.
- A coding agent reading AGENTS.md understands that it must create an intent before editing.
- Two active intent directories with overlapping paths are reported by `agent-collab status`.
- `agent-collab doctor` catches missing protocol files and missing managed AGENTS.md instructions.
- `agent-collab doctor` catches malformed `intent.json` files.
- README and generated docs describe the tool as reducing or surfacing conflicts, not fully preventing them.
- Generated docs position the tool as a coding-agent preflight protocol, not a task board.
- Stale and expired active intents are visible in `status` and `doctor`.
- The workflow remains plain JSON, Markdown, and Git-friendly.

## Recommended MVP Decisions

- Use `agent-collab` as the working package and CLI name. It is plain, memorable, and broad enough for future commands.
- Make `agent-collab start` template-first in the first release. Interactive prompts can be added after the protocol format stabilizes.
- Keep tool-specific files such as `.cursor/rules` out of the MVP. Start with AGENTS.md because it is the broadest cross-tool surface.
