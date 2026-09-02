#!/usr/bin/env node

// components/start-work-continuation/src/cli.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { stdin as processStdin, stdout as processStdout } from "node:process";

// components/start-work-continuation/src/boulder-reader.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// components/start-work-continuation/src/plan-checklist.ts
import { existsSync, readFileSync } from "node:fs";
var TODO_HEADING_PATTERN = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
var FINAL_VERIFICATION_HEADING_PATTERN = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
var SECTION_BOUNDARY_HEADING_PATTERN = /^#{1,2}(?:[ \t]+|$)/;
var FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
var SIMPLE_CHECKBOX_PATTERN = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
var TODO_CHECKBOX_PATTERN = /^- \[([ xX])\] ([1-9]\d*\. .+)$/;
var FINAL_WAVE_CHECKBOX_PATTERN = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i;
function getPlanChecklist(planPath) {
  if (!existsSync(planPath))
    return emptyChecklist();
  try {
    return parsePlanChecklist(readFileSync(planPath, "utf8"));
  } catch (error) {
    if (error instanceof Error)
      return emptyChecklist();
    throw error;
  }
}
function parsePlanChecklist(markdown) {
  const lines = markdown.split(/\r?\n/);
  if (!hasStructuredSection(lines))
    return parseSimpleChecklist(lines);
  let completed = 0;
  let remaining = 0;
  let nextTaskLabel = null;
  let section = "other";
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence))
        fence = null;
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    if (SECTION_BOUNDARY_HEADING_PATTERN.test(line)) {
      section = parseStructuredSectionHeading(line);
      continue;
    }
    if (section === "other")
      continue;
    const checkbox = parseStructuredCheckbox(line, section);
    if (checkbox === null)
      continue;
    if (checkbox.checked)
      completed += 1;
    else {
      remaining += 1;
      nextTaskLabel = nextTaskLabel ?? checkbox.label;
    }
  }
  return { completed, remaining, total: completed + remaining, nextTaskLabel };
}
function hasStructuredSection(lines) {
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence))
        fence = null;
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    if (parseStructuredSectionHeading(line) !== "other")
      return true;
  }
  return false;
}
function parseSimpleChecklist(lines) {
  let completed = 0;
  let remaining = 0;
  let nextTaskLabel = null;
  let fence = null;
  for (const line of lines) {
    if (fence !== null) {
      if (isClosingFence(line, fence))
        fence = null;
      continue;
    }
    const openingFence = parseOpeningFence(line);
    if (openingFence !== null) {
      fence = openingFence;
      continue;
    }
    const checkbox = parseSimpleTopLevelCheckbox(line);
    if (checkbox === null)
      continue;
    if (checkbox.checked)
      completed += 1;
    else {
      remaining += 1;
      nextTaskLabel = nextTaskLabel ?? checkbox.label;
    }
  }
  return { completed, remaining, total: completed + remaining, nextTaskLabel };
}
function parseStructuredSectionHeading(line) {
  if (TODO_HEADING_PATTERN.test(line))
    return "todo";
  if (FINAL_VERIFICATION_HEADING_PATTERN.test(line))
    return "final-wave";
  return "other";
}
function parseStructuredCheckbox(line, section) {
  const pattern = section === "todo" ? TODO_CHECKBOX_PATTERN : FINAL_WAVE_CHECKBOX_PATTERN;
  const match = line.match(pattern);
  const marker = match?.[1];
  const label = match?.[2];
  if (marker === undefined || label === undefined)
    return null;
  return { checked: marker.toLowerCase() === "x", label };
}
function parseSimpleTopLevelCheckbox(line) {
  const match = line.match(SIMPLE_CHECKBOX_PATTERN);
  const marker = match?.[1];
  const label = match?.[2];
  if (marker === undefined || label === undefined)
    return null;
  return { checked: marker.toLowerCase() === "x", label };
}
function parseOpeningFence(line) {
  const match = line.match(FENCE_PATTERN);
  const run = match?.[1];
  const info = match?.[2];
  const marker = run?.charAt(0);
  if (run === undefined || info === undefined || marker !== "`" && marker !== "~" || marker === "`" && info.includes("`"))
    return null;
  return { marker, length: run.length };
}
function isClosingFence(line, fence) {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
  return run?.charAt(0) === fence.marker && run.length >= fence.length;
}
function emptyChecklist() {
  return { completed: 0, remaining: 0, total: 0, nextTaskLabel: null };
}

// components/start-work-continuation/src/boulder-reader.ts
var SESSION_ID_PREFIX_PATTERN = /^(codex|opencode):/;
function readContinuationState(cwd, sessionId) {
  const boulderPath = getBoulderFilePath(cwd);
  const boulderState = readBoulderState(boulderPath);
  if (boulderState === null)
    return null;
  const work = getWorkForSession(boulderState, normalizeSessionId(sessionId, "codex"));
  if (work === null || !isContinuableStatus(work.status))
    return null;
  const planPath = resolveBoulderPlanPathForWork(cwd, work);
  const checklist = getPlanChecklist(planPath);
  if (checklist.total === 0)
    return null;
  return {
    planName: work.planName,
    planPath,
    boulderPath,
    ledgerPath: join(cwd, ".omo", "start-work", "ledger.jsonl"),
    worktreePath: work.worktreePath ?? null,
    checklist
  };
}
function readBoulderState(path) {
  try {
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    return parseBoulderState(parsed);
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function parseBoulderState(value) {
  if (!isRecord(value))
    return null;
  const works = [];
  const worksValue = value["works"];
  const hasWorksMap = isRecord(worksValue);
  if (hasWorksMap) {
    for (const workValue of Object.values(worksValue)) {
      const work = parseBoulderWork(workValue);
      if (work !== null)
        works.push(work);
    }
  }
  const mirrorWork = parseBoulderWork(value);
  if (works.length === 0 && mirrorWork === null)
    return null;
  return { works, mirrorWork, hasWorksMap };
}
function parseBoulderWork(value) {
  if (!isRecord(value))
    return null;
  const activePlan = value["active_plan"];
  const planName = value["plan_name"];
  if (typeof activePlan !== "string")
    return null;
  const status = parseBoulderWorkStatus(value["status"]);
  const sessionIds = parseSessionIds(value["session_ids"]);
  const worktreePath = value["worktree_path"];
  const startedAt = value["started_at"];
  const updatedAt = value["updated_at"];
  return {
    activePlan,
    planName: typeof planName === "string" ? planName : activePlan,
    sessionIds,
    ...status === undefined ? {} : { status },
    ...typeof startedAt === "string" ? { startedAt } : {},
    ...typeof updatedAt === "string" ? { updatedAt } : {},
    ...typeof worktreePath === "string" ? { worktreePath } : {}
  };
}
function getWorkForSession(state, normalizedSessionId) {
  let newestWork = null;
  let newestWorkMs = 0;
  for (const work of state.works) {
    if (!work.sessionIds.includes(normalizedSessionId))
      continue;
    const workMs = parseIsoToMs(work.updatedAt ?? work.startedAt) ?? 0;
    if (newestWork === null || workMs > newestWorkMs) {
      newestWork = work;
      newestWorkMs = workMs;
    }
  }
  if (newestWork !== null)
    return newestWork;
  if (state.hasWorksMap)
    return null;
  if (state.mirrorWork?.sessionIds.includes(normalizedSessionId) === true)
    return state.mirrorWork;
  return null;
}
function resolveBoulderPlanPathForWork(cwd, work) {
  const absolutePlanPath = resolveTrackedPath(cwd, work.activePlan);
  const worktreePath = work.worktreePath?.trim();
  if (worktreePath === undefined || worktreePath.length === 0)
    return absolutePlanPath;
  const relativePlanPath = relative(resolve(cwd), absolutePlanPath);
  if (relativePlanPath.length === 0 || relativePlanPath.startsWith("..") || isAbsolute(relativePlanPath)) {
    return absolutePlanPath;
  }
  const worktreePlanPath = resolve(resolveTrackedPath(cwd, worktreePath), relativePlanPath);
  return existsSync2(worktreePlanPath) ? worktreePlanPath : absolutePlanPath;
}
function resolveTrackedPath(baseDirectory, trackedPath) {
  return isAbsolute(trackedPath) ? resolve(trackedPath) : resolve(baseDirectory, trackedPath);
}
function parseBoulderWorkStatus(value) {
  if (value === "active" || value === "paused" || value === "completed" || value === "abandoned")
    return value;
  return;
}
function parseSessionIds(value) {
  if (!Array.isArray(value))
    return [];
  const sessionIds = [];
  for (const item of value) {
    if (typeof item === "string")
      sessionIds.push(normalizeSessionId(item));
  }
  return sessionIds;
}
function normalizeSessionId(sessionId, platform = "opencode") {
  if (SESSION_ID_PREFIX_PATTERN.test(sessionId))
    return sessionId;
  return `${platform}:${sessionId}`;
}
function parseIsoToMs(value) {
  if (value === undefined)
    return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
function isContinuableStatus(status) {
  return status === "active" || status === "paused";
}
function getBoulderFilePath(cwd) {
  return join(cwd, ".omo", "boulder.json");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/start-work-continuation/src/directive.ts
import { readFileSync as readFileSync3 } from "node:fs";
var START_WORK_CONTINUATION_DIRECTIVE = readFileSync3(new URL("../directive.md", import.meta.url), "utf8");

// components/start-work-continuation/src/codex-hook.ts
function runStopHook(input, fs) {
  if (!isStopInput(input))
    return "";
  if (input.stop_hook_active)
    return "";
  if (hasAllowedExternalBlockerMarker(input.last_assistant_message))
    return "";
  if (transcriptHasContextPressureMarker(input.transcript_path, fs))
    return "";
  const state = readContinuationState(input.cwd, input.session_id);
  if (state === null)
    return "";
  return JSON.stringify({
    decision: "block",
    reason: renderDirective(state, input.session_id)
  });
}
function renderDirective(state, sessionId) {
  const lineBreak = String.fromCharCode(10);
  const worktreeBlock = state.worktreePath === null ? "" : `${lineBreak}- Worktree: \`${state.worktreePath}\` (all edits, tests, and commands run inside this directory)`;
  const replacements = {
    PLAN_NAME: state.planName,
    PLAN_PATH: state.planPath,
    BOULDER_PATH: state.boulderPath,
    REMAINING_COUNT: String(state.checklist.remaining),
    TOTAL_COUNT: String(state.checklist.total),
    NEXT_TASK_LABEL: state.checklist.nextTaskLabel ?? "none (final gate pending)",
    WORKTREE_BLOCK: worktreeBlock,
    LEDGER_PATH: state.ledgerPath,
    SESSION_ID: sessionId
  };
  let rendered = START_WORK_CONTINUATION_DIRECTIVE;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${placeholder}}}`, value);
  }
  return rendered;
}
var EXTERNAL_BLOCKER_MARKER = "<start-work-blocked-external>";
var ULTRAWORK_OPENER = "ULTRAWORK MODE ENABLED!";
function hasAllowedExternalBlockerMarker(lastAssistantMessage) {
  if (lastAssistantMessage === undefined)
    return false;
  const lines = lastAssistantMessage.split(String.fromCharCode(10));
  const [firstLine = "", secondLine = ""] = lines;
  let markerLineIndex = -1;
  if (firstLine.trim() === EXTERNAL_BLOCKER_MARKER)
    markerLineIndex = 0;
  else if (firstLine.trim() === ULTRAWORK_OPENER && secondLine.trim() === EXTERNAL_BLOCKER_MARKER)
    markerLineIndex = 1;
  if (markerLineIndex === -1)
    return false;
  return lines.slice(markerLineIndex + 1).some((line) => line.trim() !== "");
}
var CONTEXT_PRESSURE_MARKERS = [
  "context compacted",
  "context_length_exceeded",
  "skill descriptions were shortened",
  "context_too_large",
  "codex ran out of room in the model's context window",
  "your input exceeds the context window",
  "long threads and multiple compactions"
];
function transcriptHasContextPressureMarker(transcriptPath, fs) {
  try {
    const transcript = fs.readFileSync(transcriptPath, "utf8").toLowerCase();
    return CONTEXT_PRESSURE_MARKERS.some((marker) => transcript.includes(marker));
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function isStopInput(value) {
  return isRecord2(value) && isStopHookEventName(value["hook_event_name"]) && typeof value["session_id"] === "string" && typeof value["turn_id"] === "string" && typeof value["transcript_path"] === "string" && typeof value["cwd"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["stop_hook_active"] === "boolean" && optionalString(value["last_assistant_message"]);
}
function isStopHookEventName(value) {
  return value === "Stop" || value === "SubagentStop";
}
function optionalString(value) {
  return value === undefined || typeof value === "string";
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/start-work-continuation/src/cli.ts
var nodeFileSystem = {
  readFileSync(path, encoding) {
    return readFileSync4(path, encoding);
  }
};
var command = process.argv[2];
var subcommand = process.argv[3];
if (command === "hook" && (subcommand === "stop" || subcommand === "subagent-stop")) {
  await runHookCli();
} else {
  process.stderr.write(`Usage: omo-start-work-continuation hook <stop|subagent-stop>
`);
  process.exitCode = 1;
}
async function runHookCli() {
  const raw = await readStdin();
  if (raw.trim().length === 0)
    return;
  const parsed = parseHookInput(raw);
  const output = runStopHook(parsed, nodeFileSystem);
  if (output.length > 0)
    processStdout.write(output);
}
function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
}
function readStdin() {
  return new Promise((resolve2) => {
    let data = "";
    processStdin.setEncoding("utf8");
    processStdin.on("data", (chunk) => {
      data += chunk;
    });
    processStdin.once("error", () => resolve2(data));
    processStdin.once("end", () => resolve2(data));
  });
}
