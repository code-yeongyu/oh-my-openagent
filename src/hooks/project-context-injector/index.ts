import { createTextPart } from "../../shared/part-factory"
import { ProjectDetector, type ProjectInfo } from "../../shared/project-detector"

export interface ProjectContextInjectorContext {
  directory: string
  client?: unknown
}

export function createProjectContextInjectorHook(ctx: ProjectContextInjectorContext) {
  const injectedSessions = new Set<string>()
  let cachedProjectInfo: ProjectInfo | null = null

  const getProjectInfo = async (): Promise<ProjectInfo> => {
    if (cachedProjectInfo) {
      return cachedProjectInfo
    }
    const detector = new ProjectDetector(ctx.directory)
    cachedProjectInfo = await detector.detect()
    return cachedProjectInfo
  }

  const formatProjectContext = (info: ProjectInfo): string => {
    const lines = [
      "[PROJECT CONTEXT]",
      `Package Manager: ${info.packageManager}`,
      `Frameworks: ${info.frameworks.length > 0 ? info.frameworks.join(", ") : "none detected"}`,
      `Code Style: ESLint=${info.codeStyle.eslint}, Prettier=${info.codeStyle.prettier}`,
    ]
    return lines.join("\n")
  }

  return {
    "chat.message": async (
      input: { sessionID: string; agent?: string; messageID?: string },
      output: { parts?: Array<{ type: string; text?: string }> }
    ): Promise<void> => {
      if (injectedSessions.has(input.sessionID)) {
        return
      }

      injectedSessions.add(input.sessionID)

      const projectInfo = await getProjectInfo()
      const contextText = formatProjectContext(projectInfo)

      if (!output.parts) {
        output.parts = []
      }

      output.parts.push(
        createTextPart({
          sessionID: input.sessionID,
          messageID: input.messageID,
          text: contextText,
        })
      )
    },
  }
}
