const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)

export const displayChars = {
  treeEnd: isCI ? "`-" : "└─",
  treeIndent: "   ",
  treeJoin: isCI ? "   " : "      ",
} as const
