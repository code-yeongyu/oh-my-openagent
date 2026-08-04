#!/usr/bin/env bun

import { renderTaskCompletion } from "../../src/components/task/renderers.ts"
import { backgroundWidgetRows } from "../../src/components/task/status-row-format.ts"
import { createRunStatsTracker } from "../../../senpi-task/src/run-stats.ts"
import { renderTaskOutputResult } from "../../../senpi-task/src/tools/output/renderers.ts"
import { renderTaskResultComponent } from "../../../senpi-task/src/tools/task/renderers.ts"

const WIDTH = 140
const RESET = "\u001b[0m"
const COLORS = {
  accent: "\u001b[36m",
  error: "\u001b[31m",
  muted: "\u001b[90m",
  success: "\u001b[32m",
  toolTitle: "\u001b[35m",
  warning: "\u001b[33m",
}

const THEME = {
  fg: (color, text) => `${COLORS[color] ?? ""}${text}${RESET}`,
  italic: (text) => `\u001b[3m${text}\u001b[23m`,
}

const EVAL_TOOL_CALL_COUNT = (() => {
  const tracker = createRunStatsTracker(0, () => 20_000)
  tracker.accept({
    type: "tool_execution_start",
    toolCallId: "eval-qa",
    toolName: "eval",
    args: { action: "run", language: "py", code: "read(); bash()" },
  })
  tracker.accept({
    type: "tool_execution_end",
    toolCallId: "eval-qa",
    toolName: "eval",
    result: {
      content: [{ type: "text", text: "done" }],
      details: {
        toolCalls: [
          { name: "read", ok: true },
          { name: "bash", ok: true },
        ],
      },
    },
    isError: false,
  })
  return tracker.snapshot(20_000).tool_calls
})()

const RUN_STATS = {
  runtime_ms: 65_000,
  turns: 3,
  tool_calls: EVAL_TOOL_CALL_COUNT,
  output_tokens: 840,
  total_tokens: 3_200,
  generation_ms: 20_000,
  tokens_per_second: 42,
  cost_usd: 0.1303,
  cache_hit_rate_last: 0.89,
  cache_hit_rate_run: 0.44,
}

function foregroundLines() {
  return renderTaskResultComponent({
    task_id: "st_foreground",
    status: "completed",
    mode: "spawn",
    category: "quick",
    execution_mode: "in-process",
    model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
    run_in_background: false,
    run_stats: { ...RUN_STATS, runtime_ms: 125_000, tool_calls: 7, tokens_per_second: 64 },
  }, THEME).render(WIDTH)
}

function backgroundLines() {
  const now = Date.parse("2026-08-03T03:00:00.000Z")
  const record = {
    task_id: "st_background",
    name: "background-stats",
    task_summary: "Background completion statistics",
    status: "running",
    category: "quick",
    execution_mode: "in-process",
    model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
    resolved_model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
    created_at: new Date(now - 65_000).toISOString(),
    updated_at: new Date(now).toISOString(),
  }
  const live = backgroundWidgetRows(
    [record],
    new Map([[record.task_id, "read src/foo.ts"]]),
    now,
    () => RUN_STATS,
    WIDTH,
  )
  const completed = renderTaskOutputResult({
    content: [{ type: "text", text: "background complete" }],
    details: {
      kind: "status",
      snapshot: {
        ...record,
        status: "completed",
        parent_session_id: "session-parent",
        root_session_id: "session-root",
        age_ms: 65_000,
        run_stats: RUN_STATS,
      },
    },
  }, { expanded: false, isPartial: false }, THEME).render(WIDTH)
  return [...live, ...completed]
}

function teamLines() {
  return renderTaskCompletion({
    role: "custom",
    customType: "senpi-task.completion",
    content: "",
    display: true,
    details: [{
      task_id: "st_team_member",
      name: "stats-member",
      status: "completed",
      category: "quick",
      model: "apitopia/z-ai/glm-5.2-ultrafast-unlocked",
      duration_ms: 65_000,
      run_stats: { ...RUN_STATS, tool_calls: 4, tokens_per_second: 250 },
      final_response: "team statistics member complete",
      continuation_hint: 'Use task_send({ to: "stats-member", message: "..." }) to continue.',
    }],
  }).render(WIDTH)
}

function scenario(name) {
  if (name === "foreground") {
    return { lines: foregroundLines(), required: ["foreground completed", "ran:2m5s", "tools:7", "tps:64"] }
  }
  if (name === "background") {
    return {
      lines: backgroundLines(),
      required: ["3 tools", "$0.1303", "42 tok/s", "1m 5s", "ran 1m 5s", "(CH: 44%)"],
      runningForbidden: ["CH:"],
      completedRequired: ["(CH: 44%)"],
    }
  }
  if (name === "team") {
    return { lines: teamLines(), required: ["name:stats-member", "status:completed", "duration:1m 5s", "tools:4", "tps:250"] }
  }
  throw new Error("usage: bun packages/omo-senpi/scripts/qa/task-stats-renderer.mjs <foreground|background|team>")
}

const selected = scenario(process.argv[2])
const visible = selected.lines.join("\n")
const plain = visible.replace(/\u001b\[[0-9;]*m/gu, "")
for (const token of selected.required) {
  if (!plain.includes(token)) throw new Error(`missing required renderer token: ${token} in ${JSON.stringify(plain)}`)
}
const [runningLine = "", completedLine = ""] = selected.lines.map((line) => line.replace(/\u001b\[[0-9;]*m/gu, ""))
for (const token of selected.runningForbidden ?? []) {
  if (runningLine.includes(token)) {
    throw new Error(`unexpected running-row token: ${token} in ${JSON.stringify(runningLine)}`)
  }
}
for (const token of selected.completedRequired ?? []) {
  if (!completedLine.includes(token)) {
    throw new Error(`missing completed-row token: ${token} in ${JSON.stringify(completedLine)}`)
  }
}
process.stdout.write(`${visible}\n`)
