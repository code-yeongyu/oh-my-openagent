// MaTrix Architect — Auto-dispatch fix tasks (closes the self-improvement loop).
//
// Reads .matrix/vault/learnings.jsonl (produced by the L1 engine) and ensures a
// fix task exists in .matrix/board.json for each recurring-error learning,
// assigned to the responsible agent (target prefix before the first dot).
// The dashboard "Tasks" tab already renders board.json, so the fix task becomes
// visible and actionable by the Operator/responsible agent — MaTrix doesn't just
// LEARN its weaknesses, it DISPATCHES fixes for them.
//
// Idempotent: a learning whose target already has an open (non-done) task is skipped.
// Safe + additive: only appends to board.json, no engine rebuild.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = "/home/shiro";
const LEARNINGS = join(HOME, ".matrix", "vault", "learnings.jsonl");
const BOARD_PATH = join(HOME, ".matrix", "board.json");

type Learning = { target?: string; rule?: string; occurrences?: number; confidence?: number };

function readBoard(): any[] {
  try {
    if (existsSync(BOARD_PATH)) return JSON.parse(readFileSync(BOARD_PATH, "utf-8"));
  } catch {}
  return [];
}

function main(): void {
  if (!existsSync(LEARNINGS)) {
    console.log("[dispatch-fix-tasks] no learnings.jsonl yet - skipping");
    return;
  }
  const lines = readFileSync(LEARNINGS, "utf-8").split("\n").filter(Boolean);
  const learnings: Learning[] = lines.map((l) => JSON.parse(l) as Learning);

  const board = readBoard();
  const openTargets = new Set(
    board
      .filter((t: any) => t.status !== "done" && t.auto_target)
      .map((t: any) => t.auto_target as string),
  );

  let created = 0;
  for (const l of learnings) {
    const target = l.target;
    if (!target) continue;
    if (openTargets.has(target)) continue;
    const agent = target.split(".")[0] || "morpheus";
    const task = {
      id: crypto.randomUUID(),
      title: `Auto-fix: ${l.rule ?? target}`,
      agent,
      status: "pending",
      priority: (l.confidence ?? 0) >= 0.8 ? "high" : "medium",
      source: "auto-improvement",
      auto_target: target,
      occurrences: l.occurrences ?? 0,
      notes: "Generated automatically by the auto-evolution loop (L1->learning). Recurring cause detected.",
      created_at: new Date().toISOString(),
    };
    board.push(task);
    openTargets.add(target);
    created++;
    console.log(`[dispatch-fix-tasks] + task -> ${agent}: ${target}`);
  }

  if (created > 0) writeFileSync(BOARD_PATH, JSON.stringify(board, null, 2) + "\n", "utf-8");
  console.log(`[dispatch-fix-tasks] ${created} task(s) created, ${board.length} total`);
}

main();
