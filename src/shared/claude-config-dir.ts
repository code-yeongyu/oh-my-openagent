import { homedir } from "node:os"
import { join } from "node:path"

export function getClaudeConfigDir(): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR
  if (envConfigDir) {
    return envConfigDir
  }
  
  return join(homedir(), ".claude")
}
