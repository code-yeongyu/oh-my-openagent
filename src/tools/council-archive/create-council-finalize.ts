import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir, rename } from "node:fs/promises"
import { join, isAbsolute, resolve, relative } from "node:path"
import { randomBytes } from "node:crypto"
import { extractCouncilResponse } from "./council-response-extractor"
import {
  buildAthenaRuntimeGuidance,
  getValidCouncilIntents,
  resolveCouncilIntent,
} from "../../agents/athena"
import { log } from "../../shared/logger"
import type { ContextCollector } from "../../features/context-injector"
import type { CouncilFinalizeArgs, CouncilMemberResult, CouncilFinalizeResult } from "./types"

interface MetaMember {
  task_id: string
  member: string
  member_slug: string
  task_output_path: string
  archive_file: string
  has_response: boolean
  response_complete: boolean
}

type RegisterContext = Pick<ContextCollector, "register">

type CouncilFinalizeToolContext = {
  sessionID?: string
}

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/")
}

function extractAgentFromFrontmatter(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  const agentLine = fmMatch[1].match(/^agent:\s*(.+)$/m)
  return agentLine ? agentLine[1].trim() : null
}

function formatMetaYaml(archiveName: string, createdAt: string, members: MetaMember[], question?: string, promptFile?: string): string {
  const lines: string[] = [
    `archive_name: ${archiveName}`,
    `created_at: ${createdAt}`,
  ]

  if (question) {
    lines.push(`question: |`)
    for (const qLine of question.split("\n")) {
      lines.push(`  ${qLine}`)
    }
  }

  if (promptFile) {
    lines.push(`prompt_file: ${promptFile}`)
  }

  lines.push("members:")

  for (const m of members) {
    lines.push(`  - task_id: ${m.task_id}`)
    lines.push(`    member: "${m.member}"`)
    lines.push(`    member_slug: ${m.member_slug}`)
    lines.push(`    task_output_path: ${m.task_output_path}`)
    lines.push(`    archive_file: ${m.archive_file}`)
    lines.push(`    has_response: ${m.has_response}`)
    lines.push(`    response_complete: ${m.response_complete}`)
  }

  return lines.join("\n") + "\n"
}

export function createCouncilFinalize(
  basePath?: string,
  options?: { contextCollector?: RegisterContext }
): ToolDefinition {
  const collector = options?.contextCollector

  return tool({
    description:
      "Finalize council task outputs: extract COUNCIL_MEMBER_RESPONSE content from raw task output files, write per-member archive files, inject intent-specific Athena runtime guidance, and create meta.yaml.",
    args: {
      task_ids: tool.schema
        .array(tool.schema.string())
        .describe("Array of background task IDs whose output files should be processed"),
      name: tool.schema.string().describe("Council name used in the archive directory name"),
      intent: tool.schema
        .string()
        .optional()
        .describe(`Classified question intent used for runtime Athena guidance injection. Valid intents: ${getValidCouncilIntents().join(", ")}`),
      question: tool.schema.string().optional().describe("Original user question that triggered the council"),
      prompt_file: tool.schema.string().optional().describe("Path to the council prompt temp file (will be moved into the archive)"),
    },
    async execute(args: CouncilFinalizeArgs, toolContext: CouncilFinalizeToolContext) {
      const resolvedIntent = resolveCouncilIntent(args.intent)
      if (args.intent && !resolvedIntent) {
        return `Invalid intent: "${args.intent}". Valid intents: ${getValidCouncilIntents().join(", ")}.`
      }

      if (collector && resolvedIntent && toolContext.sessionID) {
        collector.register(toolContext.sessionID, {
          id: "athena-runtime-guidance",
          source: "custom",
          priority: "critical",
          content: buildAthenaRuntimeGuidance(resolvedIntent),
          metadata: {
            intent: resolvedIntent,
            source: "council_finalize",
          },
        })
      }

      const base = basePath ?? process.cwd()
      const hexId = randomBytes(2).toString("hex")
      const safeName = slugify(args.name) || "unnamed"
      const archiveName = `council-${safeName}-${hexId}`
      const relArchiveDir = join(".sisyphus", "athena", archiveName)
      const relArchiveDirForOutput = toPosixPath(relArchiveDir)
      const absArchiveDir = join(base, relArchiveDir)

      const expectedArchiveRoot = join(base, ".sisyphus", "athena")
      const relFromArchiveRoot = relative(expectedArchiveRoot, absArchiveDir)
      if (relFromArchiveRoot.startsWith("..") || isAbsolute(relFromArchiveRoot)) {
        return `Security error: archive directory would escape .sisyphus/athena/`
      }

      await mkdir(absArchiveDir, { recursive: true })

      const members: CouncilMemberResult[] = []
      const metaMembers: MetaMember[] = []

      for (const taskId of args.task_ids) {
        if (!TASK_ID_PATTERN.test(taskId)) {
          members.push({
            task_id: taskId,
            member: "unknown",
            has_response: false,
            error: "Invalid task ID: contains unsafe characters",
          })
          metaMembers.push({
            task_id: taskId,
            member: "unknown",
            member_slug: "unknown",
            task_output_path: "",
            archive_file: "",
            has_response: false,
            response_complete: false,
          })
          continue
        }

        const relTaskOutput = join(".sisyphus", "task-outputs", `${taskId}.md`)
        const relTaskOutputForOutput = toPosixPath(relTaskOutput)
        const absTaskOutput = join(base, relTaskOutput)

        const expectedTaskOutputRoot = join(base, ".sisyphus", "task-outputs")
        const relFromTaskOutputRoot = relative(expectedTaskOutputRoot, absTaskOutput)
        if (relFromTaskOutputRoot.startsWith("..") || isAbsolute(relFromTaskOutputRoot)) {
          members.push({
            task_id: taskId,
            member: "unknown",
            has_response: false,
            error: "Invalid task ID: resolved path escapes task-outputs directory",
          })
          metaMembers.push({
            task_id: taskId,
            member: "unknown",
            member_slug: "unknown",
            task_output_path: "",
            archive_file: "",
            has_response: false,
            response_complete: false,
          })
          continue
        }

        let fileContent: string
        try {
          fileContent = await readFile(absTaskOutput, "utf-8")
        } catch {
          members.push({
            task_id: taskId,
            member: "unknown",
            has_response: false,
            error: "Task output file not found",
          })
          metaMembers.push({
            task_id: taskId,
            member: "unknown",
            member_slug: "unknown",
            task_output_path: relTaskOutputForOutput,
            archive_file: "",
            has_response: false,
            response_complete: false,
          })
          continue
        }

        const agentName = extractAgentFromFrontmatter(fileContent) ?? "unknown"
        const memberSlug = slugify(agentName) || "unknown"
        const taskSlug = slugify(taskId) || taskId.replace(/[^a-zA-Z0-9_-]+/g, "-")
        const extraction = extractCouncilResponse(fileContent)

        const relArchiveFile = join(relArchiveDir, `${memberSlug}-${taskSlug}.md`)
        const relArchiveFileForOutput = toPosixPath(relArchiveFile)
        const absArchiveFile = join(base, relArchiveFile)

        const memberResult: CouncilMemberResult = {
          task_id: taskId,
          member: agentName,
          has_response: extraction.has_response,
        }

        if (extraction.has_response) {
          memberResult.response_complete = extraction.response_complete
        }

        if (extraction.result !== null) {
          await writeFile(absArchiveFile, extraction.result, "utf-8")
          memberResult.archive_file = relArchiveFileForOutput
        }

        members.push(memberResult)
        metaMembers.push({
          task_id: taskId,
          member: agentName,
          member_slug: memberSlug,
          task_output_path: relTaskOutputForOutput,
          archive_file: extraction.result !== null ? relArchiveFileForOutput : "",
          has_response: extraction.has_response,
          response_complete: extraction.response_complete,
        })
      }

      let relPromptFile: string | undefined
      if (args.prompt_file) {
        try {
          const promptFilename = "council-prompt.md"
          const absPromptSrc = isAbsolute(args.prompt_file) ? args.prompt_file : resolve(base, args.prompt_file)
          const expectedPromptRoot = join(base, ".sisyphus", "tmp")
          const relFromPromptRoot = relative(expectedPromptRoot, absPromptSrc)
          if (relFromPromptRoot.startsWith("..") || isAbsolute(relFromPromptRoot)) {
            log("[council-finalize] Rejected prompt_file outside .sisyphus/tmp/", { promptFile: args.prompt_file })
          } else {
            const absPromptDest = join(absArchiveDir, promptFilename)
            await rename(absPromptSrc, absPromptDest).catch(async () => {
              const content = await readFile(absPromptSrc, "utf-8")
              await writeFile(absPromptDest, content, "utf-8")
            })
            relPromptFile = toPosixPath(join(relArchiveDir, promptFilename))
          }
        } catch (err) {
          log("[council-finalize] Failed to move prompt file", { promptFile: args.prompt_file, error: String(err) })
        }
      }

      const relMetaFile = join(relArchiveDir, "meta.yaml")
      const relMetaFileForOutput = toPosixPath(relMetaFile)
      const absMetaFile = join(base, relMetaFile)
      const createdAt = new Date().toISOString()
      await writeFile(absMetaFile, formatMetaYaml(archiveName, createdAt, metaMembers, args.question, relPromptFile), "utf-8")

      const result: CouncilFinalizeResult = {
        archive_dir: relArchiveDirForOutput,
        meta_file: relMetaFileForOutput,
        members,
      }

      return JSON.stringify(result, null, 2)
    },
  })
}
