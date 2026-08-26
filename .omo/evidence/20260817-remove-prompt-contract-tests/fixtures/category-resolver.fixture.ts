const args = {
  category: "deep",
  prompt: "Investigate the failure thoroughly before changing implementation code.",
}
const result = await resolveCategoryExecution(args, executorCtx)
expect(result.categoryPromptAppend).toContain("operating in DEEP mode")
expect(result.categoryPromptAppend).not.toContain("Skip exploration and edit immediately")
