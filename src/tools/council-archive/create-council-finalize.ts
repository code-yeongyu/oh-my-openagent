import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { extractCouncilResponse } from "./council-response-extractor"
import { TASK_ID_PATTERN, slugify, toPosixPath, extractAgentFromFrontmatter, isPathEscaping, movePromptFile } from "./council-finalize-helpers"
import { formatMetaYaml, type MetaMember } from "./meta-yaml-formatter"
import {
  buildAthenaRuntimeGuidance,
  getValidCouncilIntents,
  resolveCouncilIntent,
  COUNCIL_DEFAULTS,
} from "../../agents/athena"
import type { CouncilGuidanceMode } from "../../agents/athena"
import type { CouncilFinalizeArgs, CouncilMemberResult, CouncilFinalizeResult } from "./types"

export function createCouncilFinalize(
  basePath?: string,
): ToolDefinition {

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
        .describe(`Classified question intent used for runtime Athena guidance injection. Valid intents: ${getValidCouncilIntents().join(", ")}`),
      question: tool.schema.string().optional().describe("Original user question that triggered the council"),
      prompt_file: tool.schema.string().optional().describe("Path to the council prompt temp file (will be moved into the archive)"),
      mode: tool.schema
        .string()
        .optional()
        .describe('Council guidance mode: "interactive" (default) includes action paths with Question tool, "non-interactive" strips action paths for programmatic use'),
    },
    async execute(args: CouncilFinalizeArgs, toolContext) {
      const resolvedIntent = resolveCouncilIntent(args.intent)
      if (!resolvedIntent) {
        return `Invalid intent: "${args.intent}". Valid intents: ${getValidCouncilIntents().join(", ")}.`
      }

      const base = basePath ?? process.cwd()
      const hexId = randomBytes(COUNCIL_DEFAULTS.ARCHIVE_ID_BYTES).toString("hex")
      const safeName = slugify(args.name) || "unnamed"
      const archiveName = `council-${safeName}-${hexId}`
      const relArchiveDir = join(".sisyphus", "athena", archiveName)
      const relArchiveDirForOutput = toPosixPath(relArchiveDir)
      const absArchiveDir = join(base, relArchiveDir)

      if (isPathEscaping(join(base, ".sisyphus", "athena"), absArchiveDir)) {
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

        // Task ID is pre-validated by TASK_ID_PATTERN — path escaping is impossible
        const relTaskOutput = join(".sisyphus", "task-outputs", `${taskId}.md`)
        const relTaskOutputForOutput = toPosixPath(relTaskOutput)
        const absTaskOutput = join(base, relTaskOutput)


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

      const relPromptFile = args.prompt_file
        ? await movePromptFile(args.prompt_file, base, absArchiveDir, relArchiveDir)
        : undefined

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

      const resolvedMode = (args.mode === "non-interactive" ? "non-interactive" : "interactive") as CouncilGuidanceMode
      const guidance = buildAthenaRuntimeGuidance(resolvedIntent, resolvedMode)
      return JSON.stringify(result, null, 2) + "\n\n" + guidance
    },
  })
}
