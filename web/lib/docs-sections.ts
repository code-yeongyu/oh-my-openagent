export const DOC_SECTION_IDS = [
  "overview",
  "quick-start",
  "config-locations",
  "agents",
  "categories",
  "skills",
  "background-tasks",
  "hooks",
  "mcps",
  "browser-automation",
  "tmux",
  "git-master",
  "comment-checker",
  "experimental",
  "lsp",
  "env-vars",
] as const

export type DocSectionId = (typeof DOC_SECTION_IDS)[number]

export const DOC_SECTION_TITLE_KEYS: Record<DocSectionId, string> = {
  overview: "overview",
  "quick-start": "quickStart",
  "config-locations": "configLocations",
  agents: "agents",
  categories: "categories",
  skills: "skills",
  "background-tasks": "backgroundTasks",
  hooks: "hooks",
  mcps: "mcps",
  "browser-automation": "browserAutomation",
  tmux: "tmux",
  "git-master": "gitMaster",
  "comment-checker": "commentChecker",
  experimental: "experimental",
  lsp: "lsp",
  "env-vars": "envVars",
}
