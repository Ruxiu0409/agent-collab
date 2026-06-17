#!/usr/bin/env node

import {
  checkStagedIntentCoverage,
  doctorProject,
  doneIntent,
  getStatus,
  initProject,
  installGitHooks,
  startIntent,
  touchIntent
} from "./core.ts";

type ParsedArgs = {
  command?: string;
  flags: Record<string, string | boolean>;
  positional: string[];
};

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const root = process.cwd();

  switch (parsed.command) {
    case "init": {
      const result = await initProject(root, { mcp: hasFlag(parsed, "mcp") });
      console.log("agent-collab initialized (lite document-first setup).");
      console.log("Created AGENTS.md and .agent-collab protocol files.");
      if (hasFlag(parsed, "hooks")) {
        const hooks = await installGitHooks(root);
        console.log(`Installed optional pre-commit hook: ${relative(hooks.path)}`);
      }
      if (result.mcpGuidePath) {
        console.log(`Wrote optional MCP setup guide: ${relative(result.mcpGuidePath)}`);
      }
      return 0;
    }
    case "start": {
      const agent = requireFlag(parsed, "agent");
      const title = requireFlag(parsed, "title");
      const files = splitList(stringFlag(parsed, "files"));
      const areas = splitList(stringFlag(parsed, "areas"));
      const result = await startIntent(root, { agent, title, files, areas });
      console.log(`Created intent: ${relative(result.path)}`);
      if (result.intent.conflictCheck.result === "potential-conflict") {
        console.log(`Potential conflict: ${result.intent.conflictCheck.notes}`);
        console.log("Stop and ask the user before editing overlapping code.");
      }
      console.log("Write the detailed plan in plan.md before editing code.");
      return 0;
    }
    case "status": {
      const status = await getStatus(root);
      if (hasFlag(parsed, "json")) {
        printJson(status);
        return status.problems.length > 0 ? 1 : 0;
      }
      if (status.problems.length > 0) {
        console.log("Problems:");
        for (const problem of status.problems) console.log(`- ${problem}`);
      }
      if (status.intents.length === 0) {
        console.log("No active intents.");
      } else {
        console.log("Active intents:");
        for (const intent of status.intents) {
          const flags = [
            intent.stale ? "stale" : "",
            intent.expired ? "expired" : ""
          ].filter(Boolean);
          console.log(`- ${intent.title} (${intent.agent}) ${flags.length ? `[${flags.join(", ")}]` : ""}`);
          console.log(`  Path: ${relative(intent.path)}`);
          console.log(`  Files: ${intent.filesPlanned.join(", ") || "none"}`);
          console.log(`  Areas: ${intent.areasAffected.join(", ") || "none"}`);
        }
      }
      if (status.overlaps.length > 0) {
        console.log("\nPotential conflicts:");
        for (const overlap of status.overlaps) {
          console.log(`- ${overlap.first} overlaps ${overlap.second}`);
          if (overlap.files.length > 0) console.log(`  Files: ${overlap.files.join(", ")}`);
          if (overlap.areas.length > 0) console.log(`  Areas: ${overlap.areas.join(", ")}`);
        }
      }
      return status.problems.length > 0 ? 1 : 0;
    }
    case "doctor": {
      const report = await doctorProject(root);
      if (hasFlag(parsed, "json")) {
        printJson(report);
        return report.ok ? 0 : 1;
      }
      if (report.problems.length === 0 && report.warnings.length === 0) {
        console.log("agent-collab doctor: ok");
        return 0;
      }
      if (report.problems.length > 0) {
        console.log("Problems:");
        for (const problem of report.problems) console.log(`- ${problem}`);
      }
      if (report.warnings.length > 0) {
        console.log("Warnings:");
        for (const warning of report.warnings) console.log(`- ${warning}`);
      }
      return report.ok ? 0 : 1;
    }
    case "done": {
      const target = parsed.positional[0];
      if (!target) throw new Error("Missing intent path. Usage: agent-collab done .agent-collab/active/<intent-id>");
      const result = await doneIntent(root, target);
      console.log(`Archived intent: ${relative(result.path)}`);
      for (const warning of result.warnings) console.log(`Warning: ${warning}`);
      return 0;
    }
    case "touch": {
      const target = parsed.positional[0];
      if (!target) {
        throw new Error("Missing intent path. Usage: agent-collab touch .agent-collab/active/<intent-id>");
      }
      const result = await touchIntent(root, target);
      console.log(`Refreshed intent: ${relative(result.path)}`);
      console.log(`Updated lease until ${result.intent.expires}`);
      return 0;
    }
    case "install-hooks": {
      const result = await installGitHooks(root);
      console.log(`Installed agent-collab pre-commit hook: ${relative(result.path)}`);
      return 0;
    }
    case "check-staged": {
      const report = await checkStagedIntentCoverage(root);
      if (report.stagedFiles.length === 0) {
        console.log("agent-collab check-staged: no staged files");
        return 0;
      }
      if (report.ok) {
        console.log("agent-collab check-staged: ok");
        return 0;
      }
      console.log("agent-collab check-staged: intent coverage failed");
      if (report.problems.length > 0) {
        console.log("Problems:");
        for (const problem of report.problems) console.log(`- ${problem}`);
      }
      if (report.uncoveredFiles.length > 0) {
        console.log("Staged files without an active intent:");
        for (const file of report.uncoveredFiles) console.log(`- ${file}`);
      }
      if (report.overlappingFiles.length > 0) {
        console.log("Staged files claimed by multiple active intents:");
        for (const file of report.overlappingFiles) console.log(`- ${file}`);
      }
      console.log("Create or update an agent-collab intent before committing, or bypass with git commit --no-verify when intentional.");
      return 1;
    }
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!;
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(item);
    }
  }

  return { command, flags, positional };
}

function requireFlag(parsed: ParsedArgs, name: string): string {
  const value = stringFlag(parsed, name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function stringFlag(parsed: ParsedArgs, name: string): string {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : "";
}

function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function relative(target: string): string {
  return target.startsWith(process.cwd()) ? target.slice(process.cwd().length + 1) : target;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`agent-collab

A tiny AGENTS.md companion that makes coding agents declare intent before editing shared code.

Usage:
  agent-collab init          lite: writes AGENTS.md and .agent-collab protocol files
  agent-collab init --hooks  lite + pre-commit hook for staged-file intent checks
  agent-collab init --mcp    lite + MCP setup guide at .agent-collab/mcp.md
  agent-collab start --agent codex --title "Login validation" --files src/a.ts,src/b.ts --areas auth,login
  agent-collab status
  agent-collab status --json
  agent-collab doctor
  agent-collab doctor --json
  agent-collab touch .agent-collab/active/<intent-id>
  agent-collab install-hooks
  agent-collab check-staged
  agent-collab done .agent-collab/active/<intent-id>
`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
