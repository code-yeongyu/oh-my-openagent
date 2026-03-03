const TITLE_MAX = 80
const CMD_MAX = 60

export function extractTarget(tool: string, outputTitle?: string): string {
  if (outputTitle && outputTitle.trim()) {
    return outputTitle.trim().slice(0, TITLE_MAX)
  }
  return tool
}
