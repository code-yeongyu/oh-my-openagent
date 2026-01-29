import { z } from "zod"

export const FIXFLOW_TOOL_NAME = "fixflow_knowledge_base"

export const FIXFLOW_TOOL_DESCRIPTION = `
Perform semantic search for solutions to coding errors, or store new solutions to the knowledge base.
Use this tool when:
1. You encounter a build error, runtime exception, or unknown bug (Action: search).
2. You have successfully fixed a bug and want to remember the solution (Action: store).
`

// 環境変数があればそれを使い、なければlocalhostを使う（grepのパス解決ロジックの流儀にならう）
export function getFixFlowApiUrl(): string {
  // process.envはNode.js環境で有効
  return process.env.FIXFLOW_API_URL || "http://localhost:8000/api/v1"
}

// タイムアウト設定などもここに
export const DEFAULT_TIMEOUT_MS = 5000