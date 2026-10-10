import type { VariantTable } from "./types"

const K55 = `${String.fromCharCode(111, 112, 117, 115)}-5-5`
import v0 from "../prompts/atlas/opus-5-5.md"
import v1 from "../prompts/atlas/opus-5.md"
import v2 from "../prompts/atlas/fable-5-1.md"
import v3 from "../prompts/atlas/fable-5.md"
import v4 from "../prompts/atlas/sonnet-5-5.md"
import v5 from "../prompts/atlas/opus-5.md"
import v6 from "../prompts/atlas/opus-4-8.md"
import v7 from "../prompts/atlas/opus-4-7.md"
import v8 from "../prompts/atlas/opus-4-6.md"
import v9 from "../prompts/atlas/opus-4-5.md"
import v10 from "../prompts/atlas/gpt-6-astra.md"
import v11 from "../prompts/atlas/gpt-5.6.md"
import v12 from "../prompts/atlas/gpt-5.5.md"
import v13 from "../prompts/atlas/gpt-5.4.md"
import v14 from "../prompts/atlas/gpt-5.3-codex.md"
import v15 from "../prompts/atlas/gpt-5.2.md"
import v16 from "../prompts/atlas/kimi-k3.md"
import v18 from "../prompts/atlas/kimi-k2-8.md"
import v19 from "../prompts/atlas/kimi-k2-7.md"
import v20 from "../prompts/atlas/kimi-k2-6.md"
import v21 from "../prompts/atlas/glm-5.3.md"
import v22 from "../prompts/atlas/glm-5.2.md"
import v23 from "../prompts/atlas/deepseek-v4-flash-0731.md"
import v24 from "../prompts/atlas/deepseek-v4-1-flash.md"
import v25 from "../prompts/atlas/deepseek-v4-flash.md"
import v26 from "../prompts/atlas/deepseek-v4-pro.md"
import v27 from "../prompts/atlas/grok-4.7.md"
import v28 from "../prompts/atlas/grok-4.6.md"
import v29 from "../prompts/atlas/grok-4.5.md"
import v30 from "../prompts/atlas/gpt.md"
import v31 from "../prompts/atlas/gemini.md"
import v32 from "../prompts/atlas/kimi.md"
import v33 from "../prompts/atlas/glm.md"
import v34 from "../prompts/atlas/default.md"

export const atlasPromptVariants = {
  [K55]: {
    kind: "bundled",
    content: v0,
    filePath: "packages/prompts-core/prompts/atlas/opus-5-5.md",
  },
  "": {
    kind: "bundled",
    content: v1,
    filePath: "packages/prompts-core/prompts/atlas/opus-5.md",
  },
  "fable-5-1": {
    kind: "bundled",
    content: v2,
    filePath: "packages/prompts-core/prompts/atlas/fable-5-1.md",
  },
  "fable-5": {
    kind: "bundled",
    content: v3,
    filePath: "packages/prompts-core/prompts/atlas/fable-5.md",
  },
  "sonnet-5-5": {
    kind: "bundled",
    content: v4,
    filePath: "packages/prompts-core/prompts/atlas/sonnet-5-5.md",
  },
  "opus-5": {
    kind: "bundled",
    content: v5,
    filePath: "packages/prompts-core/prompts/atlas/opus-5.md",
  },
  "opus-4-8": {
    kind: "bundled",
    content: v6,
    filePath: "packages/prompts-core/prompts/atlas/opus-4-8.md",
  },
  "opus-4-7": {
    kind: "bundled",
    content: v7,
    filePath: "packages/prompts-core/prompts/atlas/opus-4-7.md",
  },
  "opus-4-6": {
    kind: "bundled",
    content: v8,
    filePath: "packages/prompts-core/prompts/atlas/opus-4-6.md",
  },
  "opus-4-5": {
    kind: "bundled",
    content: v9,
    filePath: "packages/prompts-core/prompts/atlas/opus-4-5.md",
  },
  "gpt-6-astra": {
    kind: "bundled",
    content: v10,
    filePath: "packages/prompts-core/prompts/atlas/gpt-6-astra.md",
  },
  "gpt-5.6": {
    kind: "bundled",
    content: v11,
    filePath: "packages/prompts-core/prompts/atlas/gpt-5.6.md",
  },
  "gpt-5.5": {
    kind: "bundled",
    content: v12,
    filePath: "packages/prompts-core/prompts/atlas/gpt-5.5.md",
  },
  "gpt-5.4": {
    kind: "bundled",
    content: v13,
    filePath: "packages/prompts-core/prompts/atlas/gpt-5.4.md",
  },
  "gpt-5.3-codex": {
    kind: "bundled",
    content: v14,
    filePath: "packages/prompts-core/prompts/atlas/gpt-5.3-codex.md",
  },
  "gpt-5.2": {
    kind: "bundled",
    content: v15,
    filePath: "packages/prompts-core/prompts/atlas/gpt-5.2.md",
  },
  "kimi-k3": {
    kind: "bundled",
    content: v16,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k3.md",
  },
  "swe-2": {
    kind: "bundled",
    content: v16,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k3.md",
  },
  "kimi-k2-8": {
    kind: "bundled",
    content: v18,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k2-8.md",
  },
  "kimi-k2-7": {
    kind: "bundled",
    content: v19,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k2-7.md",
  },
  "kimi-k2-6": {
    kind: "bundled",
    content: v20,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k2-6.md",
  },
  "glm-5.3": {
    kind: "bundled",
    content: v21,
    filePath: "packages/prompts-core/prompts/atlas/glm-5.3.md",
  },
  "glm-5.2": {
    kind: "bundled",
    content: v22,
    filePath: "packages/prompts-core/prompts/atlas/glm-5.2.md",
  },
  "deepseek-v4-flash-0731": {
    kind: "bundled",
    content: v23,
    filePath: "packages/prompts-core/prompts/atlas/deepseek-v4-flash-0731.md",
  },
  "deepseek-v4-1-flash": {
    kind: "bundled",
    content: v24,
    filePath: "packages/prompts-core/prompts/atlas/deepseek-v4-1-flash.md",
  },
  "deepseek-v4-flash": {
    kind: "bundled",
    content: v25,
    filePath: "packages/prompts-core/prompts/atlas/deepseek-v4-flash.md",
  },
  "deepseek-v4-pro": {
    kind: "bundled",
    content: v26,
    filePath: "packages/prompts-core/prompts/atlas/deepseek-v4-pro.md",
  },
  "grok-4.7": {
    kind: "bundled",
    content: v27,
    filePath: "packages/prompts-core/prompts/atlas/grok-4.7.md",
  },
  "grok-4.6": {
    kind: "bundled",
    content: v28,
    filePath: "packages/prompts-core/prompts/atlas/grok-4.6.md",
  },
  "grok-4.5": {
    kind: "bundled",
    content: v29,
    filePath: "packages/prompts-core/prompts/atlas/grok-4.5.md",
  },
  "gpt-5": {
    kind: "bundled",
    content: v30,
    filePath: "packages/prompts-core/prompts/atlas/gpt.md",
  },
  "gpt": {
    kind: "bundled",
    content: v30,
    filePath: "packages/prompts-core/prompts/atlas/gpt.md",
  },
  "gemini": {
    kind: "bundled",
    content: v31,
    filePath: "packages/prompts-core/prompts/atlas/gemini.md",
  },
  "kimi": {
    kind: "bundled",
    content: v32,
    filePath: "packages/prompts-core/prompts/atlas/kimi.md",
  },
  "glm": {
    kind: "bundled",
    content: v33,
    filePath: "packages/prompts-core/prompts/atlas/glm.md",
  },
  "default": {
    kind: "bundled",
    content: v34,
    filePath: "packages/prompts-core/prompts/atlas/default.md",
  },
} satisfies VariantTable
