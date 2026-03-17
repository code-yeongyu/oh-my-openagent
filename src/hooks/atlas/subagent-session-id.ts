export function extractSessionIdFromOutput(output: string): string | undefined {
  const taskMetadataBlocks = [...output.matchAll(/<task_metadata>([\s\S]*?)<\/task_metadata>/gi)]
  const lastTaskMetadataBlock = taskMetadataBlocks.at(-1)?.[1]
  if (lastTaskMetadataBlock) {
    const taskMetadataSessionMatch = lastTaskMetadataBlock.match(/session_id:\s*(ses_[a-zA-Z0-9_]+)/i)
    if (taskMetadataSessionMatch) {
      return taskMetadataSessionMatch[1]
    }
  }

  const explicitSessionMatches = [...output.matchAll(/Session ID:\s*(ses_[a-zA-Z0-9_]+)/g)]
  return explicitSessionMatches.at(-1)?.[1]
}
