export interface ExtractLearningsArgs {
  transcript_path?: string
  session_id?: string
}

export interface TranscriptEntry {
  type: "user" | "assistant" | "tool_use" | "tool_result"
  timestamp: string
  content?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: Record<string, unknown>
}

export interface ExtractLearningsResult {
  success: boolean
  transcript_path?: string
  transcript_lines?: number
  session_id?: string
  message: string
  error?: string
}
