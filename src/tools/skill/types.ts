import { z } from "zod/v4"

export type SkillScope = "user" | "project"

/**
 * Zod schema for skill frontmatter validation
 * Following Anthropic Agent Skills Specification v1.0
 */
export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Name must be lowercase alphanumeric with hyphens only")
    .min(1, "Name cannot be empty"),
  description: z.string().min(20, "Description must be at least 20 characters for discoverability"),
  license: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export interface SkillMetadata {
  name: string
  description: string
  license?: string
  allowedTools?: string[]
  metadata?: Record<string, string>
}

export interface SkillInfo {
  name: string
  path: string
  basePath: string
  metadata: SkillMetadata
  content: string
  references: string[]
  scripts: string[]
  assets: string[]
}

export interface LoadedSkill {
  name: string
  metadata: SkillMetadata
  basePath: string
  body: string
  referencesLoaded: Array<{ path: string; content: string }>
}
