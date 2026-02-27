import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { extractCouncilResponse } from "./council-response-extractor"
import type { CouncilFinalizeArgs, CouncilMemberResult, CouncilFinalizeResult } from "./types"

const RESULT_SIZE_LIMIT = 8000
const PREVIEW_SIZE = 500

interface MetaMember {
  task_id: string
  member: string
  member_slug: string
  task_output_path: string
  archive_file: string
  has_response: boolean
  response_complete: boolean
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function extractAgentFromFrontmatter(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  const agentLine = fmMatch[1].match(/^agent:\s*(.+)$/m)
  return agentLine ? agentLine[1].trim() : null
}

function formatMetaYaml(archiveName: string, createdAt: string, members: MetaMember[]): string {
  const lines: string[] = [
    `archive_name: ${archiveName}`,
    `created_at: ${createdAt}`,
    "members:",
  ]

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

export function createCouncilFinalize(basePath?: string): ToolDefinition {
  return tool({
    description:
      "Finalize council task outputs: extract COUNCIL_MEMBER_RESPONSE content from raw task output files, write per-member archive files, and create meta.yaml.",
    args: {
      task_ids: tool.schema
        .array(tool.schema.string())
        .describe("Array of background task IDs whose output files should be processed"),
      name: tool.schema.string().describe("Council name used in the archive directory name"),
    },
    async execute(args: CouncilFinalizeArgs) {
      const base = basePath ?? process.cwd()
      const hexId = randomBytes(2).toString("hex")
      const archiveName = `council-${args.name}-${hexId}`
      const relArchiveDir = join(".sisyphus", "athena", archiveName)
      const absArchiveDir = join(base, relArchiveDir)

      await mkdir(absArchiveDir, { recursive: true })

      const members: CouncilMemberResult[] = []
      const metaMembers: MetaMember[] = []

      for (const taskId of args.task_ids) {
        const relTaskOutput = join(".sisyphus", "task-outputs", `${taskId}.md`)
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
            task_output_path: relTaskOutput,
            archive_file: "",
            has_response: false,
            response_complete: false,
          })
          continue
        }

        const agentName = extractAgentFromFrontmatter(fileContent) ?? "unknown"
        const memberSlug = slugify(agentName)
        const extraction = extractCouncilResponse(fileContent)

        const relArchiveFile = join(relArchiveDir, `${memberSlug}.md`)
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
          memberResult.archive_file = relArchiveFile

          if (extraction.result.length > RESULT_SIZE_LIMIT) {
            memberResult.result = extraction.result.slice(0, PREVIEW_SIZE)
            memberResult.result_truncated = true
          } else {
            memberResult.result = extraction.result
          }
        }

        members.push(memberResult)
        metaMembers.push({
          task_id: taskId,
          member: agentName,
          member_slug: memberSlug,
          task_output_path: relTaskOutput,
          archive_file: extraction.result !== null ? relArchiveFile : "",
          has_response: extraction.has_response,
          response_complete: extraction.response_complete,
        })
      }

      const relMetaFile = join(relArchiveDir, "meta.yaml")
      const absMetaFile = join(base, relMetaFile)
      const createdAt = new Date().toISOString()
      await writeFile(absMetaFile, formatMetaYaml(archiveName, createdAt, metaMembers), "utf-8")

      const result: CouncilFinalizeResult = {
        archive_dir: relArchiveDir,
        meta_file: relMetaFile,
        members,
      }

      return JSON.stringify(result, null, 2)
    },
  })
}
