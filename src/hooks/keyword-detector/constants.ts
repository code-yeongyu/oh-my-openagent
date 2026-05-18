import type { KeywordType } from "../../config/schema/keyword-detector";
import {
  isPlannerAgent,
  isNonOmoAgent,
  getUltraworkMessage,
} from "./ultrawork";

export {
  isPlannerAgent,
  isNonOmoAgent,
  getUltraworkMessage,
} from "./ultrawork";

export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
export const INLINE_CODE_PATTERN = /`[^`]+`/g;

// Default patterns and messages for static modes.
// Source of truth: defaults.jsonc (reference only, not read at runtime).
// Patterns are plain strings compiled to RegExp with the `i` flag.
const DEFAULT_PATTERNS: Record<string, string> = {
  search:
    "\\b(search|find|locate|lookup|look\\s*up|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\\b|where\\s+is|show\\s+me|list\\s+all|검색|찾아|탐색|조회|스캔|서치|뒤져|찾기|어디|추적|탐지|찾아봐|찾아내|보여줘|목록|検索|探して|見つけて|サーチ|探索|スキャン|どこ|発見|捜索|見つけ出す|一覧|搜索|查找|寻找|查询|检索|定位|扫描|发现|在哪里|找出来|列出|tìm kiếm|tra cứu|định vị|quét|phát hiện|truy tìm|tìm ra|ở đâu|liệt kê",
  analyze:
    "\\b(analyze|analyse|investigate|examine|research|study|deep[\\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\\b|why\\s+is|how\\s+does|how\\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao",
  team: "\\bteam[\\s_-]?mode\\b|(?<![가-힣])(?:팀\\s*모드|팀으로)",
  hyperplan: "\\b(hyperplan|hpp)\\b",
};

const DEFAULT_MESSAGES: Record<string, string> = {
  search:
    "[search-mode]\nMAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:\n- explore agents (codebase patterns, file structures, ast-grep)\n- librarian agents (remote repos, official docs, GitHub examples)\nPlus direct tools: Grep, ripgrep (rg), ast-grep (sg)\nNEVER stop at first result - be exhaustive.",
  analyze:
    '[analyze-mode]\nANALYSIS MODE. Gather context before diving deep:\n\nCONTEXT GATHERING (parallel):\n- 1-2 explore agents (codebase patterns, implementations)\n- 1-2 librarian agents (if external library involved)\n- Direct tools: Grep, AST-grep, LSP for targeted searches\n\nIF COMPLEX - DO NOT STRUGGLE ALONE. Consult specialists:\n- **Oracle**: Conventional problems (architecture, debugging, complex logic)\n- **Artistry**: Non-conventional problems (different approach needed)\n\nSYNTHESIZE findings before proceeding.\n---\nMANDATORY delegate_task params: ALWAYS include load_skills and run_in_background when calling delegate_task. Evaluate available skills before dispatch - pass task-appropriate skills when relevant, pass [] ONLY when no skill matches the task domain.\nExample: delegate_task(subagent_type="explore", prompt="...", run_in_background=true, load_skills=[])',
  team: "[team-mode]\nTeam mode reference detected. If user wants team-mode work, MUST orchestrate via team_* tools (team_create -> team_task_create + team_send_message). NEVER substitute with delegate_task - it is not equivalent. If team_* tools are unavailable (team_mode disabled in config), instruct user to set team_mode.enabled=true and restart opencode.",
  hyperplan:
    '<hyperplan-mode>\n**MANDATORY**: Say "HYPERPLAN MODE ENABLED!" as your first response, exactly once.\n\nThe user invoked **hyperplan mode** — adversarial multi-agent planning via team-mode.\n\nLOAD THE HYPERPLAN SKILL IMMEDIATELY:\n\n```\nskill(name="hyperplan")\n```\n\nAfter loading, follow the skill\'s full workflow EXACTLY:\n1. Acknowledge and capture the planning request\n2. Spawn the adversarial team via `team_create` with category members `unspecified-low`, `unspecified-high`, `ultrabrain`, and `artistry`; include `deep` only if the category is enabled\n3. Round 1 — Independent analysis (each member produces findings)\n4. Round 2 — Cross-attack (each member ruthlessly attacks the other 4\'s findings)\n5. Round 3 — Defend, refine, or concede\n6. Distill defensible insights into a structured bundle (Lead does NOT write the plan)\n7. MANDATORY: hand the bundle to the `plan` agent via `task(subagent_type="plan", ...)` — the plan agent owns sequencing, parallelization, and verification gates\n8. Present the plan agent\'s output verbatim with provenance line, then clean up the team\n\nDo NOT improvise. Do NOT skip rounds. Do NOT write the plan yourself in step 6 — the handoff to the plan agent in step 7 is non-negotiable. Be the lead orchestrator and let the adversarial members do the cross-critique.\n\nIf team-mode is unavailable (`team_*` tools missing), instruct the user to set `team_mode.enabled: true` in `~/.config/opencode/oh-my-opencode.jsonc` and restart opencode.\n</hyperplan-mode>',
};

export interface KeywordDefaults {
  patterns: Map<KeywordType, RegExp>;
  messages: Map<KeywordType, string>;
}

const STATIC_TYPES: KeywordType[] = ["search", "analyze", "team", "hyperplan"];

const patterns = new Map<KeywordType, RegExp>();
const messages = new Map<KeywordType, string>();

for (const type of STATIC_TYPES) {
  const patternSource = DEFAULT_PATTERNS[type];
  if (patternSource) {
    try {
      patterns.set(type, new RegExp(patternSource, "i"));
    } catch {
      console.warn(
        `[keyword-detector] Invalid default pattern for "${type}", skipping`,
      );
    }
  }
  const message = DEFAULT_MESSAGES[type];
  if (message) {
    messages.set(type, message);
  }
}

export const DEFAULTS: KeywordDefaults = { patterns, messages };

export const ULTRAWORK_PATTERN = /\b(ultrawork|ulw)\b/i;

export const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i;

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**MANDATORY**: Say "HYPERPLAN ULTRAWORK MODE ENABLED!" exactly once as your first response. Do NOT say the standalone "ULTRAWORK MODE ENABLED!" or "HYPERPLAN MODE ENABLED!" banners.

Apply the ultrawork protocol below as your execution framework. You MUST ALSO load the hyperplan skill immediately via \`skill(name="hyperplan")\` and follow its full adversarial workflow — do NOT improvise, do NOT skip rounds, do NOT write the plan yourself.
</hyperplan-ultrawork-mode>`;

export function getHyperplanUltraworkMessage(
  agentName?: string,
  modelID?: string,
): string {
  return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkMessage(agentName, modelID)}`;
}

export type KeywordDetector = {
  type: KeywordType;
  pattern: RegExp;
  message: string | ((agentName?: string, modelID?: string) => string);
};

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: "ultrawork",
    pattern: ULTRAWORK_PATTERN,
    message: getUltraworkMessage,
  },
  {
    type: "search",
    pattern: patterns.get("search")!,
    message: messages.get("search")!,
  },
  {
    type: "analyze",
    pattern: patterns.get("analyze")!,
    message: messages.get("analyze")!,
  },
  {
    type: "team",
    pattern: patterns.get("team")!,
    message: messages.get("team")!,
  },
  {
    type: "hyperplan",
    pattern: patterns.get("hyperplan")!,
    message: messages.get("hyperplan")!,
  },
  {
    type: "hyperplan-ultrawork",
    pattern: HYPERPLAN_ULTRAWORK_PATTERN,
    message: getHyperplanUltraworkMessage,
  },
];
