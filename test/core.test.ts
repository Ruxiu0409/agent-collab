import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  doctorProject,
  doneIntent,
  getStatus,
  initProject,
  startIntent
} from "../src/core.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-collab-test-"));
}

test("initProject creates AGENTS.md, protocol, active, and archive", async () => {
  const root = await tempRepo();

  await initProject(root);

  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agents, /declare intent before editing shared code/i);
  assert.match(agents, /agent-collab:start/);
  await stat(path.join(root, ".agent-collab", "protocol.md"));
  await stat(path.join(root, ".agent-collab", "active"));
  await stat(path.join(root, ".agent-collab", "archive"));
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
});
