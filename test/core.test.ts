import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  checkStagedIntentCoverage,
  doctorProject,
  doneIntent,
  getStatus,
  initProject,
  installGitHooks,
  touchIntent,
  startIntent
} from "../src/core.ts";

const execFileAsync = promisify(execFile);

async function tempRepo(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-collab-test-"));
}

async function tempGitRepo(): Promise<string> {
  const root = await tempRepo();
  await execFileAsync("git", ["init"], { cwd: root });
  return root;
}

async function runCli(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const cliPath = path.resolve("src", "cli.ts");
  return execFileAsync(process.execPath, [cliPath, ...args], { cwd: root });
}

async function runCliExpectFailure(
  root: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number | string | null | undefined }> {
  try {
    await runCli(root, args);
  } catch (error) {
    const failed = error as Error & {
      stdout: string;
      stderr: string;
      code: number | string | null | undefined;
    };
    return { stdout: failed.stdout, stderr: failed.stderr, code: failed.code };
  }
  throw new Error(`Expected command to fail: ${args.join(" ")}`);
}

async function readEvents(root: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path.join(root, ".agent-collab", "events.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("initProject creates AGENTS.md, protocol, active, and archive", async () => {
  const root = await tempRepo();

  await initProject(root);

  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /declare intent before editing shared code/i);
  assert.match(agents, /agent-collab:start/);
  await stat(path.join(root, ".agent-collab", "protocol.md"));
  await stat(path.join(root, ".agent-collab", "events.jsonl"));
  await stat(path.join(root, ".agent-collab", "active"));
  await stat(path.join(root, ".agent-collab", "archive"));
});

test("default CLI init keeps the lite setup and does not install hooks", async () => {
  const root = await tempGitRepo();

  const { stdout } = await runCli(root, ["init"]);

  assert.match(stdout, /lite document-first setup/i);
  await stat(path.join(root, "AGENTS.md"));
  await stat(path.join(root, ".agent-collab", "protocol.md"));
  await assert.rejects(() => stat(path.join(root, ".git", "hooks", "pre-commit")));
});

test("init --hooks adds the optional pre-commit hook after lite setup", async () => {
  const root = await tempGitRepo();

  const { stdout } = await runCli(root, ["init", "--hooks"]);

  assert.match(stdout, /Installed optional pre-commit hook/i);
  await stat(path.join(root, ".agent-collab", "protocol.md"));
  const hook = await readFile(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
  assert.match(hook, /agent-collab check-staged/);
});

test("init --mcp writes optional MCP setup guidance without installing hooks", async () => {
  const root = await tempGitRepo();

  const { stdout } = await runCli(root, ["init", "--mcp"]);

  assert.match(stdout, /Wrote optional MCP setup guide/i);
  const guide = await readFile(path.join(root, ".agent-collab", "mcp.md"), "utf8");
  assert.match(guide, /MCP setup/i);
  assert.match(guide, /agent-collab status --json/);
  await assert.rejects(() => stat(path.join(root, ".git", "hooks", "pre-commit")));
});

test("init optional modes are additive when hooks and mcp are both requested", async () => {
  const root = await tempGitRepo();

  const { stdout } = await runCli(root, ["init", "--hooks", "--mcp"]);

  assert.match(stdout, /Installed optional pre-commit hook/i);
  assert.match(stdout, /Wrote optional MCP setup guide/i);
  await stat(path.join(root, ".git", "hooks", "pre-commit"));
  await stat(path.join(root, ".agent-collab", "mcp.md"));
});

test("help explains init tiers and what each mode writes", async () => {
  const root = await tempRepo();

  const { stdout } = await runCli(root, ["--help"]);

  assert.match(stdout, /agent-collab init\s+lite/i);
  assert.match(stdout, /agent-collab init --hooks\s+lite \+ pre-commit hook/i);
  assert.match(stdout, /agent-collab init --mcp\s+lite \+ MCP setup guide/i);
});

test("startIntent writes intent.json metadata and plan.md", async () => {
  const root = await tempRepo();
  await initProject(root);

  const result = await startIntent(root, {
    agent: "codex",
    title: "Login validation refactor",
    files: ["src/login.ts", "test/login.test.ts"],
    areas: ["login validation", "auth errors"],
    now: new Date("2026-05-26T14:30:00+08:00")
  });

  const intent = JSON.parse(await readFile(path.join(result.path, "intent.json"), "utf8"));
  assert.equal(intent.schemaVersion, 1);
  assert.equal(intent.status, "active");
  assert.equal(intent.agent, "codex");
  assert.equal(intent.title, "Login validation refactor");
  assert.deepEqual(intent.filesPlanned, ["src/login.ts", "test/login.test.ts"]);
  assert.deepEqual(intent.areasAffected, ["login validation", "auth errors"]);
  assert.equal(intent.started, "2026-05-26T06:30:00.000Z");
  assert.equal(intent.updated, "2026-05-26T06:30:00.000Z");
  assert.equal(intent.expires, "2026-05-26T10:30:00.000Z");

  const plan = await readFile(path.join(result.path, "plan.md"), "utf8");
  assert.match(plan, /# Work Intent: Login validation refactor/);
  assert.match(plan, /src\/login\.ts/);
});

test("getStatus reports overlapping planned files and stale intents", async () => {
  const root = await tempRepo();
  await initProject(root);
  const oldNow = new Date("2026-05-26T09:00:00Z");
  await startIntent(root, {
    agent: "agent-a",
    title: "Auth UI",
    files: ["src/auth.ts"],
    areas: ["auth"],
    now: oldNow
  });
  await startIntent(root, {
    agent: "agent-b",
    title: "Auth tests",
    files: ["src/auth.ts"],
    areas: ["tests"],
    now: new Date("2026-05-26T14:00:00Z")
  });

  const status = await getStatus(root, new Date("2026-05-26T14:30:00Z"));

  assert.equal(status.intents.length, 2);
  assert.equal(status.overlaps.length, 1);
  assert.deepEqual(status.overlaps[0]?.files, ["src/auth.ts"]);
  assert.equal(status.intents.find((intent) => intent.agent === "agent-a")?.stale, true);
});

test("startIntent records potential conflicts with existing active work", async () => {
  const root = await tempRepo();
  await initProject(root);
  await startIntent(root, {
    agent: "agent-a",
    title: "Auth UI",
    files: ["src/auth.ts"],
    areas: ["auth"],
    now: new Date("2026-05-26T14:00:00Z")
  });

  const result = await startIntent(root, {
    agent: "agent-b",
    title: "Auth API",
    files: ["src/auth.ts"],
    areas: ["api"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  assert.equal(result.intent.conflictCheck.result, "potential-conflict");
  assert.match(result.intent.conflictCheck.notes, /src\/auth\.ts/);
});

test("startIntent appends started and conflict events", async () => {
  const root = await tempRepo();
  await initProject(root);
  await startIntent(root, {
    agent: "agent-a",
    title: "Auth UI",
    files: ["src/auth.ts"],
    areas: ["auth"],
    now: new Date("2026-05-26T14:00:00Z")
  });

  const result = await startIntent(root, {
    agent: "agent-b",
    title: "Auth API",
    files: ["src/auth.ts"],
    areas: ["api"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  const events = await readEvents(root);

  assert.equal(events.length, 4);
  assert.equal(events[1]?.type, "intent.started");
  assert.equal(events[2]?.type, "conflict.detected");
  assert.equal(events[2]?.intentId, result.id);
  assert.equal(events[3]?.type, "intent.started");
  assert.equal(events[3]?.intentId, result.id);
});

test("doctorProject reports malformed intent.json", async () => {
  const root = await tempRepo();
  await initProject(root);
  const intentDir = path.join(root, ".agent-collab", "active", "broken-intent");
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(intentDir, { recursive: true });
  });
  await writeFile(path.join(intentDir, "intent.json"), "{broken", "utf8");

  const report = await doctorProject(root, new Date("2026-05-26T14:30:00Z"));

  assert.equal(report.ok, false);
  assert.ok(report.problems.some((problem) => problem.includes("malformed intent.json")));
});

test("doneIntent moves completed intent directory to archive", async () => {
  const root = await tempRepo();
  await initProject(root);
  const result = await startIntent(root, {
    agent: "codex",
    title: "Archive me",
    files: ["src/a.ts"],
    areas: ["archive"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  const archived = await doneIntent(root, result.path);

  await stat(path.join(archived.path, "intent.json"));
  assert.match(archived.path, /\.agent-collab\/archive\/2026-05-26T143000Z-codex-archive-me$/);
  const events = await readEvents(root);
  assert.equal(events.at(-1)?.type, "intent.archived");
});

test("touchIntent refreshes updated and expires for an active intent", async () => {
  const root = await tempRepo();
  await initProject(root);
  const startedAt = new Date("2026-05-26T14:30:00Z");
  const touchedAt = new Date("2026-05-26T16:00:00Z");
  const result = await startIntent(root, {
    agent: "codex",
    title: "Keep fresh",
    files: ["src/a.ts"],
    areas: ["coordination"],
    now: startedAt
  });

  const touched = await touchIntent(root, result.path, touchedAt);
  const intent = JSON.parse(await readFile(path.join(touched.path, "intent.json"), "utf8"));

  assert.equal(intent.started, "2026-05-26T14:30:00.000Z");
  assert.equal(intent.updated, "2026-05-26T16:00:00.000Z");
  assert.equal(intent.expires, "2026-05-26T20:00:00.000Z");
  const events = await readEvents(root);
  assert.equal(events.at(-1)?.type, "intent.touched");
});

test("event log write failures do not block startIntent", async () => {
  const root = await tempRepo();
  await initProject(root);
  const eventsPath = path.join(root, ".agent-collab", "events.jsonl");
  const blockedPath = path.join(root, ".agent-collab", "events-blocked");
  await rename(eventsPath, blockedPath);
  await mkdir(eventsPath);

  const result = await startIntent(root, {
    agent: "codex",
    title: "Keep going",
    files: ["src/safe.ts"],
    areas: ["coordination"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  const intent = JSON.parse(await readFile(path.join(result.path, "intent.json"), "utf8"));
  assert.equal(intent.title, "Keep going");
});

test("installGitHooks writes a managed pre-commit hook", async () => {
  const root = await tempGitRepo();

  const result = await installGitHooks(root);

  const hook = await readFile(path.join(root, ".git", "hooks", "pre-commit"), "utf8");
  assert.equal(result.installed, true);
  assert.match(hook, /agent-collab:start/);
  assert.match(hook, /agent-collab check-staged/);
});

test("touch CLI refreshes an intent using a relative path", async () => {
  const root = await tempRepo();
  await initProject(root);
  const result = await startIntent(root, {
    agent: "codex",
    title: "CLI touch",
    files: ["src/cli.ts"],
    areas: ["cli"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  const { stdout } = await runCli(root, ["touch", path.relative(root, result.path)]);
  const intent = JSON.parse(await readFile(path.join(result.path, "intent.json"), "utf8"));

  assert.match(stdout, /Refreshed intent:/);
  assert.ok(Date.parse(intent.updated) > Date.parse("2026-05-26T14:30:00.000Z"));
  assert.equal(
    Date.parse(intent.expires) - Date.parse(intent.updated),
    4 * 60 * 60 * 1000
  );
});

test("checkStagedIntentCoverage reports staged files without active intents", async () => {
  const root = await tempGitRepo();
  await initProject(root);
  await writeFile(path.join(root, "src.ts"), "export const value = 1;\n", "utf8");
  await execFileAsync("git", ["add", "src.ts"], { cwd: root });

  const report = await checkStagedIntentCoverage(root);

  assert.equal(report.ok, false);
  assert.deepEqual(report.uncoveredFiles, ["src.ts"]);
});

test("checkStagedIntentCoverage passes when staged files are covered by one active intent", async () => {
  const root = await tempGitRepo();
  await initProject(root);
  await startIntent(root, {
    agent: "codex",
    title: "Cover staged file",
    files: ["src.ts"],
    areas: ["hook"],
    now: new Date("2026-05-26T14:30:00Z")
  });
  await writeFile(path.join(root, "src.ts"), "export const value = 1;\n", "utf8");
  await execFileAsync("git", ["add", "src.ts"], { cwd: root });

  const report = await checkStagedIntentCoverage(root);

  assert.equal(report.ok, true);
  assert.deepEqual(report.uncoveredFiles, []);
  assert.deepEqual(report.overlappingFiles, []);
});

test("checkStagedIntentCoverage reports staged files claimed by multiple intents", async () => {
  const root = await tempGitRepo();
  await initProject(root);
  await startIntent(root, {
    agent: "agent-a",
    title: "First claim",
    files: ["src.ts"],
    areas: ["hook"],
    now: new Date("2026-05-26T14:30:00Z")
  });
  await startIntent(root, {
    agent: "agent-b",
    title: "Second claim",
    files: ["src.ts"],
    areas: ["hook"],
    now: new Date("2026-05-26T15:30:00Z")
  });
  await writeFile(path.join(root, "src.ts"), "export const value = 1;\n", "utf8");
  await execFileAsync("git", ["add", "src.ts"], { cwd: root });

  const report = await checkStagedIntentCoverage(root);

  assert.equal(report.ok, false);
  assert.deepEqual(report.overlappingFiles, ["src.ts"]);
});

test("status --json prints machine-readable status with stable top-level fields", async () => {
  const root = await tempRepo();
  await initProject(root);
  await startIntent(root, {
    agent: "codex",
    title: "JSON output",
    files: ["src/cli.ts"],
    areas: ["cli"],
    now: new Date("2026-05-26T14:30:00Z")
  });

  const { stdout } = await runCli(root, ["status", "--json"]);
  const parsed = JSON.parse(stdout);

  assert.deepEqual(Object.keys(parsed).sort(), ["intents", "overlaps", "problems"]);
  assert.equal(parsed.intents[0].title, "JSON output");
  assert.equal(typeof parsed.intents[0].expired, "boolean");
  assert.equal(typeof parsed.intents[0].stale, "boolean");
  assert.deepEqual(parsed.overlaps, []);
  assert.deepEqual(parsed.problems, []);
});

test("doctor --json prints machine-readable report with stable top-level fields", async () => {
  const root = await tempRepo();
  await initProject(root);

  const { stdout } = await runCli(root, ["doctor", "--json"]);
  const parsed = JSON.parse(stdout);

  assert.deepEqual(Object.keys(parsed).sort(), ["ok", "problems", "warnings"]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.problems, []);
  assert.ok(parsed.warnings.includes("Git repository was not detected"));
});

test("status keeps human-readable output by default", async () => {
  const root = await tempRepo();
  await initProject(root);

  const { stdout } = await runCli(root, ["status"]);

  assert.match(stdout, /No active intents\./);
  assert.throws(() => JSON.parse(stdout));
});

test("status --json exits non-zero and still prints JSON when active intent data is invalid", async () => {
  const root = await tempRepo();
  await initProject(root);
  const intentDir = path.join(root, ".agent-collab", "active", "broken-intent");
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(intentDir, { recursive: true });
  });
  await writeFile(path.join(intentDir, "intent.json"), "{broken", "utf8");

  const result = await runCliExpectFailure(root, ["status", "--json"]);
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.deepEqual(parsed.intents, []);
  assert.deepEqual(parsed.overlaps, []);
  assert.ok(parsed.problems.some((problem: string) => problem.includes("malformed intent.json")));
});

test("doctor --json exits non-zero and still prints JSON when setup is invalid", async () => {
  const root = await tempRepo();

  const result = await runCliExpectFailure(root, ["doctor", "--json"]);
  const parsed = JSON.parse(result.stdout);

  assert.equal(result.code, 1);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.problems.includes("AGENTS.md is missing"));
  assert.ok(parsed.problems.includes(".agent-collab/protocol.md is missing"));
  assert.ok(Array.isArray(parsed.warnings));
});
