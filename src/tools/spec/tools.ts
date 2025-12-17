import { tool, type PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { CreateSpecFolderResult, SpecType } from "./types"
import { SPEC_TEMPLATE_FILES, SPEC_BASE_PATHS, DEFAULT_SPEC_BASE_PATH } from "./types"
import * as fs from "fs"
import * as path from "path"

/**
 * Description for create_spec_folder tool
 */
const CREATE_SPEC_FOLDER_DESCRIPTION = `Create a spec folder for a feature.

This tool creates a standardized spec folder structure for tracking feature work:
- spec.md - Requirements and user stories
- plan.md - Architecture and implementation plan
- tasks.md - Task breakdown
- status.md - Current status tracking

Naming convention: {ISSUE-ID}-{type}-{name-slug}
Example: LIF-123-feat-user-authentication

Types: feat, fix, chore, refactor, docs, infra`

/**
 * Slugify a string for use in folder names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
}

/**
 * Get next sequential number for spec folders
 */
function getNextSequentialNumber(specsDir: string): string {
  if (!fs.existsSync(specsDir)) {
    return "001"
  }

  const entries = fs.readdirSync(specsDir)
  const numbers = entries
    .map((e) => {
      const match = e.match(/^(\d{3})-/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)

  const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0
  return String(maxNum + 1).padStart(3, "0")
}

/**
 * Find existing specs base directory or use default
 */
function findSpecsBaseDir(projectDir: string): string {
  for (const basePath of SPEC_BASE_PATHS) {
    const fullPath = path.join(projectDir, basePath)
    if (fs.existsSync(fullPath)) {
      return basePath
    }
  }
  return DEFAULT_SPEC_BASE_PATH
}

/**
 * Generate template content for spec files
 */
function generateTemplateContent(
  filename: string,
  folderId: string,
  featureName: string,
  linearIssue?: string
): string {
  const date = new Date().toISOString().split("T")[0]
  const issueLink = linearIssue
    ? `[${linearIssue}](https://linear.app/issue/${linearIssue})`
    : "N/A"

  switch (filename) {
    case "spec.md":
      return `# ${featureName}

**Linear Issue**: ${issueLink}
**Created**: ${date}
**Status**: Draft

## Overview

[Brief description of the feature]

## User Stories

- As a [user type], I want to [action] so that [benefit]

## Requirements

### Functional Requirements

1. [Requirement 1]

### Non-Functional Requirements

1. [Performance, security, etc.]

## Acceptance Criteria

- [ ] [Criterion 1]
`

    case "plan.md":
      return `# ${featureName} - Implementation Plan

**Linear Issue**: ${issueLink}
**Created**: ${date}
**Author**: [Agent Name]

## Architecture

[High-level architecture description]

## Data Models

[Key data structures]

## API Contracts

[API endpoints if applicable]

## Implementation Steps

1. [Step 1]
2. [Step 2]

## Dependencies

- [Dependency 1]

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk] | Low/Med/High | Low/Med/High | [Mitigation] |
`

    case "tasks.md":
      return `# ${featureName} - Task Breakdown

**Linear Issue**: ${issueLink}
**Created**: ${date}

## Tasks

| ID | Task | Status | Estimate | Assignee |
|----|------|--------|----------|----------|
| 1 | [Task 1] | Not Started | [X]h | - |

## Notes

[Additional task notes]
`

    case "status.md":
      return `# ${featureName} - Status

**Linear Issue**: ${issueLink}
**Last Updated**: ${date}

## Current Status

- **Phase**: Planning
- **Progress**: 0%
- **Blockers**: None

## Recent Updates

- ${date}: Spec folder created

## Next Steps

1. Complete requirements in spec.md
2. Create implementation plan
3. Break down tasks
`

    default:
      return `# ${filename}\n\nCreated: ${date}\n`
  }
}

/**
 * Creates the create_spec_folder tool
 */
export function createSpecFolderTool(ctx: PluginInput) {
  return tool({
    description: CREATE_SPEC_FOLDER_DESCRIPTION,
    args: {
      featureName: tool.schema
        .string()
        .describe("Name of the feature (will be slugified)"),
      linearIssue: tool.schema
        .string()
        .describe("Linear issue ID (e.g., 'LIF-123')")
        .optional(),
      type: tool.schema
        .enum(["feat", "fix", "chore", "refactor", "docs", "infra"] as const)
        .describe("Type of work (default: feat)")
        .optional(),
    },
    async execute(args: {
      featureName: string
      linearIssue?: string
      type?: SpecType
    }): Promise<string> {
      const type = args.type || "feat"
      const nameSlug = slugify(args.featureName)

      log(`[create_spec_folder] Creating spec folder for: ${args.featureName}`)

      try {
        // Determine folder ID
        let folderId: string
        const specsBase = findSpecsBaseDir(ctx.directory)
        const specsDir = path.join(ctx.directory, specsBase)

        if (args.linearIssue) {
          folderId = `${args.linearIssue.toUpperCase()}-${type}-${nameSlug}`
        } else {
          const seqNum = getNextSequentialNumber(specsDir)
          folderId = `${seqNum}-${type}-${nameSlug}`
        }

        const folderPath = path.join(specsBase, folderId)
        const fullFolderPath = path.join(ctx.directory, folderPath)

        // Check if folder already exists
        if (fs.existsSync(fullFolderPath)) {
          const result: CreateSpecFolderResult = {
            success: false,
            path: folderPath,
            folderId,
            message: `Spec folder already exists: ${folderPath}`,
            error: "Folder already exists",
          }
          return JSON.stringify(result, null, 2)
        }

        // Create folder
        fs.mkdirSync(fullFolderPath, { recursive: true })

        // Create template files
        const createdFiles: string[] = []
        for (const filename of SPEC_TEMPLATE_FILES) {
          const content = generateTemplateContent(
            filename,
            folderId,
            args.featureName,
            args.linearIssue
          )
          const filePath = path.join(fullFolderPath, filename)
          fs.writeFileSync(filePath, content, "utf-8")
          createdFiles.push(path.join(folderPath, filename))
        }

        // Create changelog subdirectory
        const changelogDir = path.join(fullFolderPath, "changelog")
        fs.mkdirSync(changelogDir, { recursive: true })

        const result: CreateSpecFolderResult = {
          success: true,
          path: folderPath,
          folderId,
          createdFiles,
          message: `Created spec folder: ${folderPath} with ${createdFiles.length} template files`,
        }

        log(`[create_spec_folder] Success:`, result)
        return JSON.stringify(result, null, 2)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[create_spec_folder] Error:`, errorMessage)

        const result: CreateSpecFolderResult = {
          success: false,
          message: `Failed to create spec folder`,
          error: errorMessage,
        }
        return JSON.stringify(result, null, 2)
      }
    },
  })
}
