export const semantic_scholar = {
  type: "local" as const,
  command: ["npx", "-y", "@yogsoth-ai/semantic-scholar-mcp"],
  enabled: true,
  env: process.env.SEMANTIC_SCHOLAR_API_KEY
    ? { SS_API_KEY: process.env.SEMANTIC_SCHOLAR_API_KEY }
    : undefined,
}
