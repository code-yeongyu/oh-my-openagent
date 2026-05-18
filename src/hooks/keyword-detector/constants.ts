import { readFileSync } from "node:fs";
import { join } from "node:path";
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

interface DefaultsData {
  patterns: Record<string, string>;
  messages: Record<string, string>;
}

function parseJsonc(raw: string): unknown {
  const stripped = raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const cleaned = stripped.replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(cleaned);
}

const defaultsPath = join(import.meta.dir, "defaults.jsonc");
const defaultsRaw = readFileSync(defaultsPath, "utf-8");
const defaultsData = parseJsonc(defaultsRaw) as DefaultsData;

export interface KeywordDefaults {
  patterns: Map<KeywordType, RegExp>;
  messages: Map<KeywordType, string>;
}

const STATIC_TYPES: KeywordType[] = ["search", "analyze", "team", "hyperplan"];

const patterns = new Map<KeywordType, RegExp>();
const messages = new Map<KeywordType, string>();

for (const type of STATIC_TYPES) {
  const patternSource = defaultsData.patterns[type];
  if (patternSource) {
    try {
      patterns.set(type, new RegExp(patternSource, "i"));
    } catch {
      console.warn(
        `[keyword-detector] Invalid default pattern for "${type}", skipping`,
      );
    }
  }
  const message = defaultsData.messages[type];
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
