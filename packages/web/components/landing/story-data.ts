export const PLATFORMS = [
  "Slack",
  "Discord",
  "Teams",
  "Webex",
  "Telegram",
  "WhatsApp",
  "LINE",
  "WeChat",
  "iMessage",
  "Instagram",
  "KakaoTalk",
  "Channel Talk",
  "Lark",
] as const

export const MODEL_PROFILES = [
  "Claude Fable 5.1 Max",
  "GPT 6 Astra High",
  "Kimi For Coding Highspeed",
  "Grok 4.6 xHigh",
  "GLM 5.2",
  "DeepSeek V4.1 Flash",
  "Claude Opus 5 High",
  "GPT 5.6 Sol Medium",
  "GPT 5.6 Luna Fast",
  "Claude Sonnet 5",
  "GPT 6 Astra Max",
  "Claude Fable 5.1 Medium",
] as const

export interface SkillEntry {
  readonly name: string
  readonly blurb: string
}

export const SKILLS: readonly SkillEntry[] = [
  { name: "frontend", blurb: "design system, layout, motion, visual QA" },
  { name: "debugging", blurb: "hypothesis loop, failing test first" },
  { name: "ulw-research", blurb: "thousands of sources, claim graph, cited report" },
  { name: "data-scientist", blurb: "DuckDB, Polars, charts from raw files" },
  { name: "git-master", blurb: "atomic commits, rebase, bisect" },
  { name: "ultimate-browsing", blurb: "JS pages, logins, screenshots" },
  { name: "imagegen", blurb: "photos, mockups, transparent assets" },
  { name: "visual-qa", blurb: "375 / 768 / 1280 screenshot gate" },
  { name: "ast-grep", blurb: "structural search and codemods" },
  { name: "review-work", blurb: "one reviewer, real QA evidence" },
  { name: "prompt-engineering", blurb: "smallest correct edit to a prompt" },
  { name: "lsp-setup", blurb: "language servers wired for the agent" },
]

export const CRAFTED_ITEM_COUNT = 7
export const KIBITZER_STEP_COUNT = 4
