#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs";
import { resolveSenpiInvocation } from "./team-e2e-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mockProvider = join(scriptDir, "mock-provider", "index.ts");
const realAgentDir = join(homedir(), ".senpi", "agent");
const headSentinel = "CAP_E2E_HEAD";
const middleSentinel = "CAP_E2E_SECRET_MIDDLE";
const tailSentinel = "CAP_E2E_TAIL";
const aggregateHead = "CAP_AGGREGATE_HEAD";
const aggregateMiddle = "CAP_AGGREGATE_SECRET_MIDDLE";
const aggregateTail = "CAP_AGGREGATE_TAIL";

function environment(sandbox, sessionDir) {
  const home = join(sandbox.root, "home");
  mkdirSync(home, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_CODING_AGENT_DIR: sandbox.agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
  };
}

function runPrint({ senpiBin, sandbox, sessionDir, probeTool, prompt, steps, continuation = false }) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps }, null, 2)}\n`);
  const invocation = resolveSenpiInvocation(senpiBin);
  return spawnSync(
    invocation.command,
    [...invocation.prefixArgs,
      "-e",
      mockProvider,
      "-e",
      probeTool,
      "-p",
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "--session-dir",
      sessionDir,
      ...(continuation ? ["-c"] : []),
      prompt,
    ],
    {
      cwd: sandbox.cwd,
      env: environment(sandbox, sessionDir),
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function sessionEvidence(sessionDir) {
  const transcriptChunks = [];
  const toolResultChunks = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        visit(full);
        continue;
      }
      if (!item.name.endsWith(".jsonl")) continue;
      const file = readFileSync(full, "utf8");
      transcriptChunks.push(file);
      for (const line of file.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const entry = JSON.parse(line);
          if (entry?.message?.role === "toolResult") toolResultChunks.push(JSON.stringify(entry.message.content));
        } catch {}
      }
    }
  };
  visit(sessionDir);
  return { transcript: transcriptChunks.join("\n"), toolResults: toolResultChunks.join("\n") };
}

function main() {
  const senpiBin = process.env.SENPI_BIN?.trim() || (process.platform === "win32" ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm", "senpi.cmd") : "senpi");
  const beforeDigest = credentialDigest(realAgentDir);
  const sandbox = createSandbox();
  const sessionDir = join(sandbox.root, "sessions");
  let report;

  try {
    seedSandbox(sandbox);
    mkdirSync(sessionDir, { recursive: true });
    const probeTool = join(sandbox.root, "result-size-cap-probe.mjs");
    writeFileSync(probeTool, `export default function (pi) { pi.registerTool({ name: "result_size_cap_probe", label: "Result cap probe", description: "Deterministic QA-only large result", parameters: { type: "object", properties: { mode: { type: "string" } }, additionalProperties: false }, async execute(_id, params) { if (params.mode === "aggregate") return { content: [{ type: "text", text: "${aggregateHead}" + "C".repeat(600000) }, { type: "text", text: "D".repeat(300000) + "${aggregateMiddle}" + "D".repeat(300000) + "${aggregateTail}" }] }; return { content: [{ type: "text", text: "${headSentinel}" + "A".repeat(4194304) + "${middleSentinel}" + "B".repeat(4194304) + "${tailSentinel}" }] }; } }); }\n`);
    const first = runPrint({
      senpiBin,
      sandbox,
      sessionDir,
      probeTool,
      prompt: "run the deterministic large-result probe",
      steps: [
        { type: "tool_call", name: "result_size_cap_probe", arguments: { mode: "single" } },
        { type: "tool_call", name: "result_size_cap_probe", arguments: { mode: "aggregate" } },
        { type: "text", text: "TOOL_TURN_DONE" },
      ],
    });
    const next = runPrint({
      senpiBin,
      sandbox,
      sessionDir,
      probeTool,
      prompt: "continue after the bounded tool result",
      continuation: true,
      steps: [{ type: "text", text: "NEXT_TURN_OK" }],
    });
    const { transcript, toolResults } = sessionEvidence(sessionDir);
    const markerCount = toolResults.match(/<truncated:\d+ bytes original;/g)?.length ?? 0;
    const capEvents = `${first.stderr || ""}\n${next.stderr || ""}`.match(/omo-senpi tool result capped/g)?.length ?? 0;
    report = {
      result:
        first.status === 0 &&
        next.status === 0 &&
        toolResults.includes(headSentinel) &&
        toolResults.includes(tailSentinel) &&
        !toolResults.includes(middleSentinel) &&
        toolResults.includes(aggregateHead) &&
        toolResults.includes(aggregateTail) &&
        !toolResults.includes(aggregateMiddle) &&
        toolResults.includes("aggregate middle elided") &&
        transcript.includes("NEXT_TURN_OK") &&
        markerCount === 2 &&
        capEvents === 2
          ? "PASS"
          : "FAIL",
      firstExitStatus: first.status,
      firstSignal: first.signal,
      firstError: first.error?.message,
      firstStderrTail: first.stderr?.slice(-1000),
      nextExitStatus: next.status,
      nextSignal: next.signal,
      nextError: next.error?.message,
      nextStderrTail: next.stderr?.slice(-500),
      headPresent: toolResults.includes(headSentinel),
      tailPresent: toolResults.includes(tailSentinel),
      middleAbsent: !toolResults.includes(middleSentinel),
      nextTurnOk: transcript.includes("NEXT_TURN_OK"),
      aggregateHeadPresent: toolResults.includes(aggregateHead),
      aggregateTailPresent: toolResults.includes(aggregateTail),
      aggregateMiddleAbsent: !toolResults.includes(aggregateMiddle),
      aggregateMarkerPresent: toolResults.includes("aggregate middle elided"),
      markerCount,
      redactedCapEventCount: capEvents,
      transcriptBytes: Buffer.byteLength(transcript, "utf8"),
      realAgentDirUnchanged: beforeDigest === credentialDigest(realAgentDir),
    };
  } finally {
    if (process.env.OMO_SENPI_QA_KEEP !== "1") rmSync(sandbox.root, { recursive: true, force: true });
  }

  const kept = process.env.OMO_SENPI_QA_KEEP === "1";
  const finalReport = { ...report, ...(kept ? { sandboxRoot: sandbox.root } : {}), cleanup: kept || !existsSync(sandbox.root) ? "PASS" : "FAIL" };
  console.log(JSON.stringify(finalReport, null, 2));
  if (finalReport.result !== "PASS" || finalReport.cleanup !== "PASS" || finalReport.realAgentDirUnchanged !== true) {
    process.exitCode = 1;
  }
}

main();
