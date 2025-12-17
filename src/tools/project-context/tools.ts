import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { ReadContextResult, ContextSection } from "./types"
import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

/**
 * Description for read_context tool
 */
const READ_CONTEXT_DESCRIPTION = `Read the project context configuration.

This tool reads the project-context.yaml file which contains:
- Project metadata (name, type, description)
- Technology stack (languages, frameworks, databases)
- Architecture pattern and layers
- Integration settings (Linear, Mintlify)
- Coding conventions

Use this to understand the project setup before making decisions.

Sections: all, project, tech_stack, architecture, integrations, conventions`

/**
 * Possible locations for project context file
 */
const CONTEXT_FILE_LOCATIONS = [
  ".opencode/project-context.yaml",
  ".opencode/project-context.yml",
  "project-context.yaml",
  "project-context.yml",
]

/**
 * Creates the read_context tool
 */
export function createReadContextTool(ctx: PluginInput) {
  return tool({
    description: READ_CONTEXT_DESCRIPTION,
    args: {
      section: tool.schema
        .enum(["all", "project", "tech_stack", "architecture", "integrations", "conventions"] as const)
        .describe("Specific section to retrieve (default: all)")
        .optional(),
    },
    async execute(args: { section?: ContextSection }): Promise<string> {
      const section = args.section || "all"
      log(`[read_context] Reading section: ${section}`)

      try {
        // Find the context file
        let contextPath: string | null = null
        for (const location of CONTEXT_FILE_LOCATIONS) {
          const fullPath = path.join(ctx.directory, location)
          if (fs.existsSync(fullPath)) {
            contextPath = fullPath
            break
          }
        }

        if (!contextPath) {
          const result: ReadContextResult = {
            success: false,
            initialized: false,
            error: `Project context file not found. Looked in: ${CONTEXT_FILE_LOCATIONS.join(", ")}`,
          }
          return JSON.stringify(result, null, 2)
        }

        // Read and parse YAML
        const content = fs.readFileSync(contextPath, "utf-8")
        const context = yaml.parse(content) as Record<string, unknown>

        // Get available sections
        const availableSections = Object.keys(context)

        // Return requested section or all
        if (section === "all") {
          const result: ReadContextResult = {
            success: true,
            initialized: true,
            context,
            availableSections,
          }
          return JSON.stringify(result, null, 2)
        }

        // Return specific section
        if (!(section in context)) {
          const result: ReadContextResult = {
            success: false,
            initialized: true,
            section,
            availableSections,
            error: `Section "${section}" not found in project context`,
          }
          return JSON.stringify(result, null, 2)
        }

        const result: ReadContextResult = {
          success: true,
          initialized: true,
          section,
          context: { [section]: context[section] },
          availableSections,
        }
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[read_context] Error:`, errorMessage)

        const result: ReadContextResult = {
          success: false,
          initialized: false,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}
