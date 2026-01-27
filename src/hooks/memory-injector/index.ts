import { injectHookMessage } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import fs from "fs/promises"
import path from "path"
import os from "os"

const MEMORY_BASE_PATH = path.join(os.homedir(), ".config", "opencode", "learning")
const PROFILE_PATH = path.join(MEMORY_BASE_PATH, "user_profile.md")

export function createMemoryInjectorHook() {
  return async (ctx: { sessionID: string, providerID: string, modelID: string, directory: string }): Promise<void> => {
    try {
      let profileContent = ""
      try {
        profileContent = await fs.readFile(PROFILE_PATH, "utf-8")
      } catch (e) {
        // Silent fail if no profile
        return
      }

      if (!profileContent.trim()) return

      const memoryPrompt = `
<SystemMemory>
  <UserProfile>
${profileContent}
  </UserProfile>
  <Instruction>
    Use this profile to adapt your behavior. 
    Use 'memory-detective' skill for deeper project history.
  </Instruction>
</SystemMemory>
`
      injectHookMessage(ctx.sessionID, memoryPrompt, {
        agent: "general",
        model: { providerID: ctx.providerID, modelID: ctx.modelID },
        path: { cwd: ctx.directory },
      })
      
      log("[memory-injector] Injected profile", { sessionID: ctx.sessionID })

    } catch (error) {
      log("[memory-injector] Error", { error })
    }
  }
}
