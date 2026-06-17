import { execFile } from "node:child_process";
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export type StartIntentOptions = {
  agent: string;
  title: string;
  files: string[];
  areas: string[];
  now?: Date;
};

export type InitProjectOptions = {
  mcp?: boolean;
};

export type InitProjectResult = {
  root: string;
  mcpGuidePath?: string;
};

export type IntentJson = {
  schemaVersion: 1;
  status: "active" | "completed" | "archived";
  agent: string;
  title: string;
  started: string;
  updated: string;
  expires: string;
  filesPlanned: string[];
  areasAffected: string[];
  conflictCheck: {
    checkedAt: string;
    result: "no-conflict" | "potential-conflict";
    notes: string;
  };
  completion: {
    changedFiles: string[];
    verificationRun: string[];
    handoffNotes: string;
  };
};

export type StatusIntent = IntentJson & {
  id: string;
  path: string;
  stale: boolean;
  expired: boolean;
  ageMs: number;
};

export type StatusReport = {
  intents: StatusIntent[];
  overlaps: Array<{
    first: string;
    second: string;
    files: string[];
    areas: string[];
  }>;
  problems: string[];
};

export type DoctorReport = {
  ok: boolean;
  problems: string[];
  warnings: string[];
};

export type GitHooksInstallReport = {
  path: string;
  installed: boolean;
};

export type StagedIntentCoverageReport = {
  ok: boolean;
  stagedFiles: string[];
  uncoveredFiles: string[];
  overlappingFiles: string[];
  problems: string[];
};

export type TouchIntentResult = {
  path: string;
  intent: IntentJson;
};

export async function initProject(
  root: string,
  options: InitProjectOptions = {}
): Promise<InitProjectResult> {
  await mkdir(collabPath(root), { recursive: true });
  await mkdir(activePath(root), { recursive: true });
  await mkdir(archivePath(root), { recursive: true });
  await writeFile(path.join(collabPath(root), "protocol.md"), formatProtocol(), "utf8");
  await writeFile(eventsPath(root), "", "utf8");
  await upsertAgentsFile(root);
  await appendEvent(root, {
    type: "project.initialized",
    time: new Date().toISOString(),
    mcp: options.mcp === true
  });
  if (options.mcp) {
    const mcpGuidePath = path.join(collabPath(root), "mcp.md");
    await writeFile(mcpGuidePath, formatMcpSetupGuide(), "utf8");
    return { root, mcpGuidePath };
  }
  return { root };
}

export async function startIntent(
  root: string,
  options: StartIntentOptions
): Promise<{ id: string; path: string; intent: IntentJson }> {
  const now = options.now ?? new Date();
  const existing = await readActiveIntents(root, now);
  const potential = findPotentialOverlap(options, existing.intents);
  const id = `${formatIntentTimestamp(now)}-${slugify(options.agent)}-${slugify(options.title)}`;
  const intentDir = path.join(activePath(root), id);
  await mkdir(intentDir, { recursive: false });

  const intent: IntentJson = {
    schemaVersion: 1,
    status: "active",
    agent: options.agent,
    title: options.title,
    started: now.toISOString(),
    updated: now.toISOString(),
    expires: new Date(now.getTime() + STALE_AFTER_MS).toISOString(),
    filesPlanned: options.files,
    areasAffected: options.areas,
    conflictCheck: {
      checkedAt: now.toISOString(),
      result: potential.length > 0 ? "potential-conflict" : "no-conflict",
      notes:
        potential.length > 0
          ? `Potential overlap with active work: ${potential.join("; ")}`
          : "No active work touches the same files or affected areas."
    },
    completion: {
      changedFiles: [],
      verificationRun: [],
      handoffNotes: ""
    }
  };

  await writeFile(path.join(intentDir, "intent.json"), `${JSON.stringify(intent, null, 2)}\n`, "utf8");
  await writeFile(path.join(intentDir, "plan.md"), formatPlan(options), "utf8");
  if (potential.length > 0) {
    await appendEvent(root, {
      type: "conflict.detected",
      time: now.toISOString(),
      intentId: id,
      files: options.files,
      areas: options.areas,
      overlaps: potential
    });
  }
  await appendEvent(root, {
    type: "intent.started",
    time: now.toISOString(),
    intentId: id,
    agent: intent.agent,
    title: intent.title
  });

  return { id, path: intentDir, intent };
}

export async function getStatus(root: string, now = new Date()): Promise<StatusReport> {
  const { intents, problems } = await readActiveIntents(root, now);
  return {
    intents,
    overlaps: findOverlaps(intents),
    problems
  };
}

export async function doctorProject(root: string, now = new Date()): Promise<DoctorReport> {
  const problems: string[] = [];
  const warnings: string[] = [];

  await requirePath(path.join(root, "AGENTS.md"), "AGENTS.md is missing", problems);
  await requirePath(path.join(collabPath(root), "protocol.md"), ".agent-collab/protocol.md is missing", problems);
  await requirePath(activePath(root), ".agent-collab/active is missing", problems);
  await requirePath(archivePath(root), ".agent-collab/archive is missing", problems);

  try {
    const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
    if (!agents.includes("agent-collab:start") || !agents.includes("agent-collab:end")) {
      problems.push("AGENTS.md is missing the managed agent-collab section");
    }
  } catch {
    // Already reported above.
  }

  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
  } catch {
    warnings.push("Git repository was not detected");
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
    if (stdout.trim().length > 0) {
      warnings.push("Uncommitted changes are present");
    }
  } catch {
    // Git warning already covers this.
  }

  const status = await getStatus(root, now);
  problems.push(...status.problems);
  for (const intent of status.intents) {
    if (intent.expired) {
      warnings.push(`expired intent: ${intent.path}`);
    } else if (intent.stale) {
      warnings.push(`stale intent: ${intent.path}`);
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

export async function doneIntent(
  root: string,
  intentPath: string
): Promise<{ path: string; warnings: string[] }> {
  const source = path.isAbsolute(intentPath) ? intentPath : path.join(root, intentPath);
  const intent = await readIntentDirectory(source);
  const warnings = validateIntent(intent.intent);
  if (warnings.length > 0) {
    throw new Error(`Cannot archive invalid intent: ${warnings.join("; ")}`);
  }
  if (intent.intent.completion.changedFiles.length === 0) {
    warnings.push("completion.changedFiles is empty");
  }
  if (intent.intent.completion.verificationRun.length === 0) {
    warnings.push("completion.verificationRun is empty");
  }

  const archivedIntent: IntentJson = {
    ...intent.intent,
    status: "archived"
  };
  await writeFile(
    path.join(source, "intent.json"),
    `${JSON.stringify(archivedIntent, null, 2)}\n`,
    "utf8"
  );

  await mkdir(archivePath(root), { recursive: true });
  const destination = path.join(archivePath(root), path.basename(source));
  await rename(source, destination);
  await appendEvent(root, {
    type: "intent.archived",
    time: new Date().toISOString(),
    intentId: path.basename(destination),
    agent: archivedIntent.agent,
    title: archivedIntent.title
  });
  return { path: destination, warnings };
}

export async function touchIntent(
  root: string,
  intentPath: string,
  now = new Date()
): Promise<TouchIntentResult> {
  const target = path.isAbsolute(intentPath) ? intentPath : path.join(root, intentPath);
  const { intent } = await readIntentDirectory(target);
  const warnings = validateIntent(intent);
  if (warnings.length > 0) {
    throw new Error(`Cannot refresh invalid intent: ${warnings.join("; ")}`);
  }
  if (intent.status !== "active") {
    throw new Error(`Cannot refresh a ${intent.status} intent`);
  }

  const refreshed: IntentJson = {
    ...intent,
    updated: now.toISOString(),
    expires: new Date(now.getTime() + STALE_AFTER_MS).toISOString()
  };

  await writeFile(path.join(target, "intent.json"), `${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
  await appendEvent(root, {
    type: "intent.touched",
    time: now.toISOString(),
    intentId: path.basename(target),
    agent: refreshed.agent,
    title: refreshed.title
  });
  return { path: target, intent: refreshed };
}

export async function installGitHooks(root: string): Promise<GitHooksInstallReport> {
  const hookPath = await resolveGitHookPath(root, "pre-commit");
  await mkdir(path.dirname(hookPath), { recursive: true });

  const section = formatPreCommitHookSection();
  let existing = "";
  let hadExistingHook = true;
  try {
    existing = await readFile(hookPath, "utf8");
  } catch {
    hadExistingHook = false;
  }

  const start = "# agent-collab:start";
  const end = "# agent-collab:end";
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  let next: string;

  if (!hadExistingHook) {
    next = `#!/bin/sh\n\n${section}\n`;
  } else if (startIndex >= 0 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + end.length).trimStart();
    next = `${before}\n\n${section}\n${after ? `\n${after}` : ""}`;
  } else {
    const prefix = existing.startsWith("#!") ? existing.trimEnd() : `#!/bin/sh\n\n${existing.trimEnd()}`;
    next = `${prefix}\n\n${section}\n`;
  }

  await writeFile(hookPath, next, "utf8");
  await chmod(hookPath, 0o755);
  return { path: hookPath, installed: true };
}

export async function checkStagedIntentCoverage(
  root: string,
  now = new Date()
): Promise<StagedIntentCoverageReport> {
  const stagedFiles = await readStagedFiles(root);
  const status = await getStatus(root, now);
  const uncoveredFiles: string[] = [];
  const overlappingFiles: string[] = [];

  for (const file of stagedFiles) {
    const coveringIntents = status.intents.filter((intent) => intent.filesPlanned.includes(file));
    if (coveringIntents.length === 0) {
      uncoveredFiles.push(file);
    } else if (coveringIntents.length > 1) {
      overlappingFiles.push(file);
    }
  }

  return {
    ok:
      status.problems.length === 0 &&
      uncoveredFiles.length === 0 &&
      overlappingFiles.length === 0,
    stagedFiles,
    uncoveredFiles,
    overlappingFiles,
    problems: status.problems
  };
}

function collabPath(root: string): string {
  return path.join(root, ".agent-collab");
}

function activePath(root: string): string {
  return path.join(collabPath(root), "active");
}

function archivePath(root: string): string {
  return path.join(collabPath(root), "archive");
}

function eventsPath(root: string): string {
  return path.join(collabPath(root), "events.jsonl");
}

function formatProtocol(): string {
  return `# agent-collab Protocol

Before editing code, every coding agent must:

1. Read AGENTS.md.
2. Inspect .agent-collab/active/*/intent.json and plan.md.
3. Run git status --short.
4. Re-read every file it plans to edit.
5. Stop and ask the user if planned files or affected areas overlap.
6. Create an active intent directory before editing.
7. Update intent.json and plan.md when the plan changes.
8. Run agent-collab done or move completed work to .agent-collab/archive/.
`;
}

function formatAgentsSection(): string {
  return `<!-- agent-collab:start -->
## agent-collab preflight

This repository uses agent-collab. It reduces stale-agent overwrites by making coding agents declare intent before editing shared code.

Before editing code:

1. Read .agent-collab/protocol.md.
2. Inspect .agent-collab/active/*/intent.json and .agent-collab/active/*/plan.md.
3. Run git status --short.
4. Re-read every file you plan to edit.
5. If planned files or affected areas overlap with active work, stop and ask the user.
6. Create your own active intent with agent-collab start before editing code.
7. Update your intent while working and archive it with agent-collab done when complete.
<!-- agent-collab:end -->`;
}

function formatPreCommitHookSection(): string {
  return `# agent-collab:start
if command -v agent-collab >/dev/null 2>&1; then
  agent-collab check-staged || exit $?
else
  echo "agent-collab: command not found; skipping intent coverage check."
fi
# agent-collab:end`;
}

function formatMcpSetupGuide(): string {
  return `# agent-collab MCP setup

This repository uses the lite agent-collab protocol by default. MCP integration is optional and should be wired explicitly by MCP-aware tools.

Current machine-readable surfaces:

- agent-collab status --json
- agent-collab doctor --json
- agent-collab start --agent <name> --title <title> --files <files> --areas <areas>
- agent-collab done .agent-collab/active/<intent-id>

Suggested MCP tool mapping:

| MCP tool | CLI behavior |
| --- | --- |
| agent_collab_status | Run agent-collab status --json. |
| agent_collab_doctor | Run agent-collab doctor --json. |
| agent_collab_start | Run agent-collab start with explicit agent, title, files, and areas. |
| agent_collab_done | Run agent-collab done with an active intent path. |

This file is setup guidance only. agent-collab does not install a daemon, background service, or MCP server during init.
`;
}

async function upsertAgentsFile(root: string): Promise<void> {
  const agentsPath = path.join(root, "AGENTS.md");
  const section = formatAgentsSection();
  let existing = "";
  try {
    existing = await readFile(agentsPath, "utf8");
  } catch {
    await writeFile(agentsPath, `# AGENTS.md\n\n${section}\n`, "utf8");
    return;
  }

  const start = "<!-- agent-collab:start -->";
  const end = "<!-- agent-collab:end -->";
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + end.length).trimStart();
    await writeFile(agentsPath, `${before}\n\n${section}\n${after ? `\n${after}` : ""}`, "utf8");
    return;
  }

  await writeFile(agentsPath, `${existing.trimEnd()}\n\n${section}\n`, "utf8");
}

function formatPlan(options: StartIntentOptions): string {
  const files = options.files.map((file) => `- ${file}`).join("\n") || "- None listed";
  const areas = options.areas.map((area) => `- ${area}`).join("\n") || "- None listed";
  return `# Work Intent: ${options.title}

## Goal

${options.title}

## Files Planned

${files}

## Areas Affected

${areas}

## Plan

1. Re-read the files listed above.
2. Make the smallest safe code change for the stated goal.
3. Update tests or verification notes.
4. Refresh intent.json if the plan changes.

## Verification Plan

- Run the most relevant tests or checks for the changed files.

## Handoff Notes

None yet.
`;
}

async function readActiveIntents(
  root: string,
  now: Date
): Promise<{ intents: StatusIntent[]; problems: string[] }> {
  const intents: StatusIntent[] = [];
  const problems: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(activePath(root));
  } catch {
    return { intents, problems };
  }

  for (const entry of entries) {
    const intentDir = path.join(activePath(root), entry);
    const itemStat = await stat(intentDir).catch(() => undefined);
    if (!itemStat?.isDirectory()) {
      continue;
    }
    try {
      const { intent } = await readIntentDirectory(intentDir);
      const validation = validateIntent(intent);
      if (validation.length > 0) {
        problems.push(`invalid intent.json at ${intentDir}: ${validation.join("; ")}`);
        continue;
      }
      const updated = new Date(intent.updated);
      const expires = new Date(intent.expires);
      intents.push({
        ...intent,
        id: entry,
        path: intentDir,
        stale: now.getTime() - updated.getTime() > STALE_AFTER_MS,
        expired: now.getTime() > expires.getTime(),
        ageMs: now.getTime() - updated.getTime()
      });
    } catch (error) {
      problems.push(`malformed intent.json at ${intentDir}: ${(error as Error).message}`);
    }
  }

  return { intents, problems };
}

async function readIntentDirectory(intentDir: string): Promise<{ intent: IntentJson }> {
  const raw = await readFile(path.join(intentDir, "intent.json"), "utf8");
  return { intent: JSON.parse(raw) as IntentJson };
}

async function appendEvent(root: string, event: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(eventsPath(root), `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Audit logging is advisory and must not block core coordination flows.
  }
}

async function readStagedFiles(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { cwd: root }
  );
  return stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

async function resolveGitHookPath(root: string, hookName: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", `hooks/${hookName}`], {
    cwd: root
  });
  const resolved = stdout.trim();
  return path.isAbsolute(resolved) ? resolved : path.join(root, resolved);
}

function validateIntent(intent: IntentJson): string[] {
  const problems: string[] = [];
  if (intent.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (!["active", "completed", "archived"].includes(intent.status)) problems.push("status is invalid");
  if (!isNonEmptyString(intent.agent)) problems.push("agent is required");
  if (!isNonEmptyString(intent.title)) problems.push("title is required");
  if (!isIsoDate(intent.started)) problems.push("started must be an ISO timestamp");
  if (!isIsoDate(intent.updated)) problems.push("updated must be an ISO timestamp");
  if (!isIsoDate(intent.expires)) problems.push("expires must be an ISO timestamp");
  if (!Array.isArray(intent.filesPlanned) || !intent.filesPlanned.every(isString)) {
    problems.push("filesPlanned must be an array of strings");
  }
  if (!Array.isArray(intent.areasAffected) || !intent.areasAffected.every(isString)) {
    problems.push("areasAffected must be an array of strings");
  }
  if (!intent.completion || !Array.isArray(intent.completion.changedFiles)) {
    problems.push("completion.changedFiles must be an array");
  }
  if (!intent.completion || !Array.isArray(intent.completion.verificationRun)) {
    problems.push("completion.verificationRun must be an array");
  }
  return problems;
}

function findOverlaps(intents: StatusIntent[]): StatusReport["overlaps"] {
  const overlaps: StatusReport["overlaps"] = [];
  for (let firstIndex = 0; firstIndex < intents.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < intents.length; secondIndex += 1) {
      const first = intents[firstIndex]!;
      const second = intents[secondIndex]!;
      const files = intersection(first.filesPlanned, second.filesPlanned);
      const areas = intersection(
        first.areasAffected.map((area) => area.toLowerCase()),
        second.areasAffected.map((area) => area.toLowerCase())
      );
      if (files.length > 0 || areas.length > 0) {
        overlaps.push({ first: first.id, second: second.id, files, areas });
      }
    }
  }
  return overlaps;
}

function findPotentialOverlap(options: StartIntentOptions, intents: StatusIntent[]): string[] {
  const results: string[] = [];
  const plannedAreas = options.areas.map((area) => area.toLowerCase());
  for (const intent of intents) {
    const files = intersection(options.files, intent.filesPlanned);
    const areas = intersection(
      plannedAreas,
      intent.areasAffected.map((area) => area.toLowerCase())
    );
    if (files.length > 0 || areas.length > 0) {
      const parts = [
        files.length > 0 ? `files ${files.join(", ")}` : "",
        areas.length > 0 ? `areas ${areas.join(", ")}` : ""
      ].filter(Boolean);
      results.push(`${intent.id} (${parts.join("; ")})`);
    }
  }
  return results;
}

function intersection(first: string[], second: string[]): string[] {
  const secondSet = new Set(second);
  return first.filter((item) => secondSet.has(item));
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "intent";
}

function formatIntentTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function requirePath(target: string, message: string, problems: string[]): Promise<void> {
  try {
    await stat(target);
  } catch {
    problems.push(message);
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
