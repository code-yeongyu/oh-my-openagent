import type {
  KeywordType,
  ModeConfig,
} from "../../config/schema/keyword-detector";
import { isRealUserTextPart } from "../../shared/internal-initiator-marker";
import {
  CODE_BLOCK_PATTERN,
  INLINE_CODE_PATTERN,
  DEFAULTS,
  KEYWORD_DETECTORS,
} from "./constants";

export interface DetectedKeyword {
  type: KeywordType;
  message: string;
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/;

export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text);
}

function resolveMessage(
  message: string | ((agentName?: string, modelID?: string) => string),
  agentName?: string,
  modelID?: string,
): string {
  return typeof message === "function" ? message(agentName, modelID) : message;
}

function applyPatternAppend(
  type: KeywordType,
  defaultPattern: RegExp,
  modeConfig?: ModeConfig,
): RegExp {
  if (!modeConfig?.pattern_append) return defaultPattern;
  const defaultSource =
    DEFAULTS.patterns.get(type)?.source ?? defaultPattern.source;
  try {
    return new RegExp(defaultSource + modeConfig.pattern_append, "i");
  } catch {
    console.warn(
      `[keyword-detector] Invalid pattern_append for "${type}", using default`,
    );
    return defaultPattern;
  }
}

function applyMessageOverride(
  defaultMessage: string | ((agentName?: string, modelID?: string) => string),
  modeConfig?: ModeConfig,
  agentName?: string,
  modelID?: string,
): string {
  const resolved = resolveMessage(defaultMessage, agentName, modelID);
  if (typeof defaultMessage === "function") return resolved;
  if (modeConfig && "message" in modeConfig && modeConfig.message !== undefined)
    return modeConfig.message;
  if (
    modeConfig &&
    "message_append" in modeConfig &&
    modeConfig.message_append !== undefined
  )
    return resolved + modeConfig.message_append;
  return resolved;
}

export function detectKeywords(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: ReadonlyArray<KeywordType>,
  modes?: Record<string, ModeConfig>,
): string[] {
  return detectKeywordsWithType(
    text,
    agentName,
    modelID,
    disabledKeywords,
    modes,
  ).map(({ message }) => message);
}

export function detectKeywordsWithType(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: ReadonlyArray<KeywordType>,
  modes?: Record<string, ModeConfig>,
): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text);
  const disabled = new Set<KeywordType>(disabledKeywords ?? []);
  if (disabled.has("ultrawork") || disabled.has("hyperplan")) {
    disabled.add("hyperplan-ultrawork");
  }
  return KEYWORD_DETECTORS.map(({ type, pattern, message }) => {
    const modeConfig = modes?.[type];
    const effectivePattern = applyPatternAppend(type, pattern, modeConfig);
    return {
      matches: effectivePattern.test(textWithoutCode),
      type,
      message: applyMessageOverride(message, modeConfig, agentName, modelID),
    };
  })
    .filter((result) => result.matches && !disabled.has(result.type))
    .map(({ type, message }) => ({ type, message }));
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>,
): string {
  return parts
    .filter(isRealUserTextPart)
    .map((p) => p.text || "")
    .join(" ");
}
