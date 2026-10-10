// One source of truth for the Atlas preset matrix (issue #9851): every variant is either a real
// authored file under prompts/atlas/ or a base body plus a calibration delta from
// atlas-calibration-fragments. No variant is a hand-copied file, so a fix to a base body or a
// fragment reaches every preset that carries it. The model display name is injected at load
// time through the `{MODEL_DISPLAY}` token, so headers name the resolved model instead of
// pinning one version string per file.

import type { BundledVariantTable, PromptSource } from "./types"
import { ATLAS_PRESET_FRAGMENTS } from "./atlas-calibration-fragments"

import defaultMd from "../prompts/atlas/default.md"
import gptMd from "../prompts/atlas/gpt.md"
import geminiMd from "../prompts/atlas/gemini.md"
import kimiMd from "../prompts/atlas/kimi.md"
import glmMd from "../prompts/atlas/glm.md"
import kimiK27Md from "../prompts/atlas/kimi-k2-7.md"
import kimiK3Md from "../prompts/atlas/kimi-k3.md"
import opus47Md from "../prompts/atlas/opus-4-7.md"
import opus45Md from "../prompts/atlas/opus-4-5.md"
import opus46Md from "../prompts/atlas/opus-4-6.md"
import opus48Md from "../prompts/atlas/opus-4-8.md"
import opus5Md from "../prompts/atlas/opus-5.md"
import opus55Md from "../prompts/atlas/opus-5-5.md"
import fable5Md from "../prompts/atlas/fable-5.md"
import fable51Md from "../prompts/atlas/fable-5-1.md"
import sonnet55Md from "../prompts/atlas/sonnet-5-5.md"

export const MODEL_DISPLAY_TOKEN = "{MODEL_DISPLAY}"

type PresetDerivation =
  | { readonly kind: "file"; readonly content: string }
  | { readonly kind: "template"; readonly base: string; readonly familyPhrase: string }
  | { readonly kind: "fragment"; readonly base: string }

function renderTemplate(base: string, familyPhrase: string): string {
  return base.replaceAll(familyPhrase, MODEL_DISPLAY_TOKEN)
}

const ATLAS_PRESET_SOURCES = {
  default: { kind: "file", content: defaultMd },
  gpt: { kind: "file", content: gptMd },
  gemini: { kind: "file", content: geminiMd },
  kimi: { kind: "file", content: kimiMd },
  glm: { kind: "file", content: glmMd },
  "kimi-k2-7": { kind: "file", content: kimiK27Md },
  "kimi-k3": { kind: "file", content: kimiK3Md },
  "swe-2": { kind: "file", content: kimiK3Md },
  "opus-4-7": { kind: "file", content: opus47Md },
  "opus-4-5": { kind: "file", content: opus45Md },
  "opus-4-6": { kind: "file", content: opus46Md },
  "opus-4-8": { kind: "file", content: opus48Md },
  "opus-5": { kind: "file", content: opus5Md },
  "opus-5-5": { kind: "file", content: opus55Md },
  "fable-5": { kind: "file", content: fable5Md },
  "fable-5-1": { kind: "file", content: fable51Md },
  "sonnet-5-5": { kind: "file", content: sonnet55Md },
  "gpt-5.2": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "gpt-5.3-codex": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "gpt-5.4": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "gpt-5.5": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "gpt-5.6": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "gpt-6-astra": { kind: "template", base: gptMd, familyPhrase: "GPT-family models" },
  "glm-5.2": { kind: "template", base: glmMd, familyPhrase: "GLM 5.2" },
  "glm-5.3": { kind: "template", base: glmMd, familyPhrase: "GLM 5.2" },
  "kimi-k2-6": { kind: "template", base: kimiMd, familyPhrase: "Kimi K2.6" },
  "kimi-k2-8": { kind: "template", base: kimiMd, familyPhrase: "Kimi K2.6" },
  "deepseek-v4-1-flash": { kind: "fragment", base: defaultMd },
  "deepseek-v4-flash": { kind: "fragment", base: defaultMd },
  "deepseek-v4-flash-0731": { kind: "fragment", base: defaultMd },
  "deepseek-v4-pro": { kind: "fragment", base: defaultMd },
  "haiku-5-5": { kind: "fragment", base: defaultMd },
  "grok-4.5": { kind: "fragment", base: defaultMd },
  "grok-4.6": { kind: "fragment", base: defaultMd },
  "grok-4.7": { kind: "fragment", base: defaultMd },
} as const satisfies Readonly<Record<string, PresetDerivation>>

export type AtlasPresetName = keyof typeof ATLAS_PRESET_SOURCES

const GPT_FAMILY_LABELS: Readonly<Record<string, string>> = {
  "gpt-6-astra": "the GPT-6 family (Astra, Sol, Luna)",
}

export function atlasPresetDisplayName(preset: string): string {
  return GPT_FAMILY_LABELS[preset] ?? preset
}

export function renderAtlasPresetContent(preset: AtlasPresetName, displayName?: string): string {
  const source = ATLAS_PRESET_SOURCES[preset]
  const display = displayName ?? atlasPresetDisplayName(preset)
  switch (source.kind) {
    case "file":
      return source.content
    case "template":
      return renderTemplate(source.base, source.familyPhrase).replaceAll(MODEL_DISPLAY_TOKEN, display)
    case "fragment":
      return ATLAS_PRESET_FRAGMENTS[preset as keyof typeof ATLAS_PRESET_FRAGMENTS] + source.base
  }
}

function toPromptSource(preset: AtlasPresetName): BundledVariantTable[string] {
  return {
    kind: "bundled",
    content: renderAtlasPresetContent(preset),
    filePath: `packages/prompts-core/prompts/atlas/${preset}.md`,
  }
}

export const atlasPromptVariants: BundledVariantTable = Object.fromEntries(
  (Object.keys(ATLAS_PRESET_SOURCES) as AtlasPresetName[]).map((preset) => [preset, toPromptSource(preset)]),
)

// The parity contract consumed by runtime-preset-parity.test.ts: same ids in, same variant out.
// Each case pairs a representative model id with the Atlas variant it must resolve to through
// resolveVariant. The expected variant is the plugin's own resolution, so the fixture stays honest
// when routing changes; the runtime's shared PROMPT_PRESET_MODEL_CASES fixture mirrors this case
// shape, and once it is published to a consumable surface the parity test converges to import and
// resolve the runtime's fixture instead of this local mirror.
export type RuntimePresetCase = {
  readonly providerID: string
  readonly modelID: string
  readonly preset: AtlasPresetName
}

export const RUNTIME_PRESET_MODEL_CASES: readonly RuntimePresetCase[] = [
  { providerID: "openai", modelID: "gpt-6-astra", preset: "gpt-6-astra" },
  { providerID: "openai", modelID: "gpt-5.6", preset: "gpt-5.6" },
  { providerID: "openai", modelID: "gpt-5.5", preset: "gpt-5.5" },
  { providerID: "openai", modelID: "gpt-5.4", preset: "gpt-5.4" },
  { providerID: "openai", modelID: "gpt-5.3-codex", preset: "gpt-5.3-codex" },
  { providerID: "openai", modelID: "gpt-5.2", preset: "gpt-5.2" },
  { providerID: "moonshotai", modelID: "kimi-k3", preset: "kimi-k3" },
  { providerID: "kimi-for-coding", modelID: "kimi-for-coding", preset: "kimi-k2-8" },
  { providerID: "kimi-for-coding", modelID: "kimi-for-coding-highspeed", preset: "kimi-k2-7" },
  { providerID: "moonshotai", modelID: "kimi-k2.6", preset: "kimi-k2-6" },
  { providerID: "zai-coding-plan", modelID: "glm-5.3", preset: "glm-5.3" },
  { providerID: "zai-coding-plan", modelID: "glm-5.2", preset: "glm-5.2" },
  { providerID: "deepseek", modelID: "deepseek-v4-flash-0731", preset: "deepseek-v4-flash-0731" },
  { providerID: "deepseek", modelID: "deepseek-flash", preset: "deepseek-v4-1-flash" },
  { providerID: "fireworks", modelID: "accounts/fireworks/models/deepseek-v4-flash", preset: "deepseek-v4-flash" },
  { providerID: "deepseek", modelID: "deepseek-v4-pro", preset: "deepseek-v4-pro" },
  { providerID: "xai", modelID: "grok-4.7", preset: "grok-4.7" },
  { providerID: "xai", modelID: "grok-4.6", preset: "grok-4.6" },
  { providerID: "xai", modelID: "grok-4.5", preset: "grok-4.5" },
  { providerID: "anthropic", modelID: "claude-fable-5", preset: "fable-5" },
  { providerID: "anthropic", modelID: "claude-fable-5.1", preset: "fable-5-1" },
  { providerID: "anthropic", modelID: "claude-opus-5.5", preset: "opus-5-5" },
  { providerID: "anthropic", modelID: "claude-opus-5", preset: "opus-5" },
  { providerID: "anthropic", modelID: "claude-sonnet-5.5", preset: "sonnet-5-5" },
  { providerID: "anthropic", modelID: "claude-haiku-5.5", preset: "haiku-5-5" },
  { providerID: "anthropic", modelID: "claude-opus-4-8", preset: "opus-4-8" },
  { providerID: "anthropic", modelID: "claude-opus-4-7", preset: "opus-4-7" },
  { providerID: "anthropic", modelID: "claude-opus-4-6", preset: "opus-4-6" },
  { providerID: "anthropic", modelID: "claude-opus-4-5", preset: "opus-4-5" },
] as const

// Presets reachable from the fixture; the Atlas table additionally carries generic family variants
// (gpt, gemini, kimi, glm, default) and swe-2, which are reached by family matchers / routing rather
// than by a single representative id, so they are asserted separately in the parity test.
