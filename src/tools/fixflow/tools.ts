import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { FIXFLOW_TOOL_DESCRIPTION, getFixFlowApiUrl, DEFAULT_TIMEOUT_MS } from "./constants"

type FixFlowArgs = {
  action: "search" | "store" | "feedback"
  query?: string
  solution?: string
  issue_id?: string
  feedback_type?: "view" | "useful"
}

// 【重要】変数名 = ツール名になります。nameプロパティは不要です。
export const fixflow_knowledge_base: ToolDefinition = tool({
  description: FIXFLOW_TOOL_DESCRIPTION,
  args: {
    action: tool.schema
      .enum(["search", "store", "feedback"])
      .describe("Action to perform: 'search' for solutions, 'store' a new solution, or 'feedback' to rate a solution."),
    query: tool.schema
      .string()
      .optional()
      .describe("The error message, log content, or search keywords. Required for 'search' and 'store'."),
    solution: tool.schema
      .string()
      .optional()
      .describe("The detailed solution or fix. Required only when action is 'store'."),
    issue_id: tool.schema
      .string()
      .optional()
      .describe("The ID of the issue to provide feedback for. Required for 'feedback'."),
    feedback_type: tool.schema
      .enum(["view", "useful"])
      .optional()
      .describe("The type of feedback: 'view' (read) or 'useful' (helpful). Required for 'feedback'.")
  },
  execute: async (args: FixFlowArgs) => {
    const apiUrl = getFixFlowApiUrl()
    const { action, query, solution, issue_id, feedback_type } = args

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

      if (action === "search") {
        if (!query) return "Error: 'query' is required for search action."
        
        const response = await fetch(`${apiUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query,
            limit: 5
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) return `Error searching: ${response.statusText}`
        const data = await response.json()
        return JSON.stringify(data, null, 2)

      } else if (action === "store") {
        if (!query || !solution) return "Error: 'query' and 'solution' are required for store action."
        
        const response = await fetch(`${apiUrl}/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: query.slice(0, 50),
            content: query,
            solution: solution,
            tags: ["agent"],
            metadata: { source: "opencode-agent" }
          }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        
        if (!response.ok) return `Error storing: ${response.statusText}`
        const data = await response.json()
        return `Successfully stored knowledge. ID: ${data.id}`

      } else if (action === "feedback") {
        if (!issue_id || !feedback_type) return "Error: 'issue_id' and 'feedback_type' are required for feedback action."

        const response = await fetch(`${apiUrl}/issues/${issue_id}/feedback?type=${feedback_type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) return `Error sending feedback: ${response.statusText}`
        return `Successfully recorded ${feedback_type} for issue ${issue_id}`
      }
      
      return "Error: Invalid action"
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})