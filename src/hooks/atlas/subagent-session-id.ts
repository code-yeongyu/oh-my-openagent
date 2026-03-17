export function extractSessionIdFromOutput(output: string): string | undefined {
  const taskMetadataMatches = [...output.matchAll(/<task_metadata>[\s\S]*?session_id:\s*(ses_[a-zA-Z0-9_]+)[\s\S]*?<\/task_metadata>/gi)]
  const lastTaskMetadataMatch = taskMetadataMatches.at(-1)
  if (lastTaskMetadataMatch) {
    return lastTaskMetadataMatch[1]
  }

  const explicitSessionMatches = [...output.matchAll(/Session ID:\s*(ses_[a-zA-Z0-9_]+)/g)]
  return explicitSessionMatches.at(-1)?.[1]
}
