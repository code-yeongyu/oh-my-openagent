// MaTrix Architect — L2 rule synthesis (closes the L1 -> L2 loop).
//
// Reads .matrix/vault/learnings.jsonl (produced by the self-improvement engine
// L1 step) and synthesizes a single injected rule file at
// .omo/rules/matrix-learnings.md. The engine's built-in rules-injector hook
// scans .omo/rules/*.md and injects them into agent context. We use
// `alwaysApply: true` frontmatter so the lessons reach EVERY agent session
// regardless of the active file (verified against @oh-my-opencode/rules-engine
// matcher: a rule with no paths/globs only applies when alwaysApply is true).
//
// Safe + additive: writes a markdown file only, no engine rebuild, no agent
// prompt mutation. Previous version is backed up before overwrite.
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const HOME = "/home/shiro";
const LEARNINGS = join(HOME, ".matrix", "vault", "learnings.jsonl");
const RULES_DIR = join(HOME, ".omo", "rules");
const RULES_FILE = join(RULES_DIR, "matrix-learnings.md");
const BACKUP = join(RULES_DIR, "matrix-learnings.md.bak");

const MAX_RULES = 25;
const MIN_CONFIDENCE = 0.6;
const MIN_OCCURRENCES = 2;

type Learning = {
  target?: string;
  rule?: string;
  rationale?: string;
  occurrences?: number;
  confidence?: number;
  created_at?: string;
};

function main(): void {
  if (!existsSync(LEARNINGS)) {
    console.log("[apply-learnings] no learnings.jsonl yet - skipping");
    return;
  }

  const raw = readFileSync(LEARNINGS, "utf8").split("\n").filter(Boolean);
  const learnings: Learning[] = raw.map((l) => JSON.parse(l) as Learning);

  const byTarget = new Map<string, Learning>();
  for (const l of learnings) {
    const key = l.target ?? "unknown";
    const prev = byTarget.get(key);
    if (!prev || (l.occurrences ?? 0) > (prev.occurrences ?? 0)) byTarget.set(key, l);
  }

  const selected = [...byTarget.values()]
    .filter((l) => (l.confidence ?? 0) >= MIN_CONFIDENCE && (l.occurrences ?? 0) >= MIN_OCCURRENCES)
    .sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0))
    .slice(0, MAX_RULES);

  mkdirSync(RULES_DIR, { recursive: true });

  const header =
    "---\n" +
    "alwaysApply: true\n" +
    "description: MaTrix auto-learnings synthesized from recurring tool errors (L1->L2)\n" +
    "---\n" +
    "\n" +
    "# MaTrix Auto-Learnings\n" +
    "\n" +
    "> Generated from `.matrix/vault/learnings.jsonl` by the self-improvement engine. Do not edit by hand.\n" +
    "> These are recurring error patterns captured during tool execution. Follow them to avoid repeating past mistakes.\n";

  let body: string;
  if (selected.length === 0) {
    body = "\n_No high-confidence recurring patterns captured yet._\n";
  } else {
    body =
      "\n## Recurring error patterns to avoid\n\n" +
      selected
        .map((l) => {
          const rule = (l.rule ?? "").replace(/\s+/g, " ").trim();
          const occ = l.occurrences ?? 0;
          const conf = Math.round((l.confidence ?? 0) * 100);
          return `- **${l.target}**: ${rule} _(seen ${occ}x, confidence ${conf}%)_`;
        })
        .join("\n") +
      "\n";
  }

  const content = header + body;
  if (existsSync(RULES_FILE)) copyFileSync(RULES_FILE, BACKUP);
  writeFileSync(RULES_FILE, content, "utf8");
  console.log(`[apply-learnings] synthesized ${selected.length} rules -> ${RULES_FILE}`);
}

main();
