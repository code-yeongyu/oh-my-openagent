export const websearch = {
  type: "remote" as const,
  url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
  enabled: true,
  headers: process.env.EXA_API_KEY
    ? { "x-api-key": process.env.EXA_API_KEY }
    : undefined,
  // Disable OAuth auto-detection - Exa uses API key header, not OAuth
  oauth: false as const,
}
