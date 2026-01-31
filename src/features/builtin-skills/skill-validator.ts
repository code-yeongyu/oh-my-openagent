/**
 * Skill Document Validator
 *
 * Validates that all SKILL.md files contain required sections.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export interface ValidationResult {
  skillName: string
  filePath: string
  hasWhenToUse: boolean
  hasBoundaries: boolean
  hasAntiPatterns: boolean
  isValid: boolean
  missingParts: string[]
}

const REQUIRED_SECTIONS = [
  { name: "When to Use", patterns: [/^##\s*When to Use/im, /^##\s*When To Use/im] },
  { name: "Boundaries", patterns: [/^##\s*Not For/im, /^##\s*Boundaries/im, /^##\s*Not For \/ Boundaries/im] },
  { name: "Anti-Patterns", patterns: [/^##\s*Anti-?Patterns?/im] },
]

/**
 * Validate a single SKILL.md file
 */
export function validateSkillFile(filePath: string, skillName: string): ValidationResult {
  const content = readFileSync(filePath, "utf-8")
  const missingParts: string[] = []

  const hasWhenToUse = REQUIRED_SECTIONS[0].patterns.some(p => p.test(content))
  const hasBoundaries = REQUIRED_SECTIONS[1].patterns.some(p => p.test(content))
  const hasAntiPatterns = REQUIRED_SECTIONS[2].patterns.some(p => p.test(content))

  if (!hasWhenToUse) missingParts.push("When to Use")
  if (!hasBoundaries) missingParts.push("Boundaries/Not For")
  if (!hasAntiPatterns) missingParts.push("Anti-Patterns")

  return {
    skillName,
    filePath,
    hasWhenToUse,
    hasBoundaries,
    hasAntiPatterns,
    isValid: missingParts.length === 0,
    missingParts,
  }
}

/**
 * Validate all SKILL.md files in builtin-skills directory
 */
export function validateAllSkillFiles(builtinSkillsDir: string): ValidationResult[] {
  const results: ValidationResult[] = []

  if (!existsSync(builtinSkillsDir)) {
    return results
  }

  const skillDirs = readdirSync(builtinSkillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  for (const skillDir of skillDirs) {
    const skillPath = join(builtinSkillsDir, skillDir, "SKILL.md")
    if (existsSync(skillPath)) {
      results.push(validateSkillFile(skillPath, skillDir))
    }
  }

  return results
}

/**
 * Get summary of validation results
 */
export function getValidationSummary(results: ValidationResult[]): {
  total: number
  valid: number
  invalid: number
  missingBySection: Record<string, number>
} {
  const missingBySection: Record<string, number> = {
    "When to Use": 0,
    "Boundaries/Not For": 0,
    "Anti-Patterns": 0,
  }

  for (const result of results) {
    for (const missing of result.missingParts) {
      missingBySection[missing] = (missingBySection[missing] || 0) + 1
    }
  }

  return {
    total: results.length,
    valid: results.filter(r => r.isValid).length,
    invalid: results.filter(r => !r.isValid).length,
    missingBySection,
  }
}
