/**
 * Plan Reorganizer
 *
 * Moves completed phases to the bottom of tasks.md files.
 * Implements Manus principle of keeping active work visible.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"

interface PhaseInfo {
  /** Phase header line (e.g., "## Phase 1: Setup `complete`") */
  header: string
  /** Start line index (0-based) */
  startLine: number
  /** End line index (exclusive) */
  endLine: number
  /** All lines including header */
  lines: string[]
  /** Whether all checkboxes in this phase are [x] */
  isComplete: boolean
}

/**
 * Check if all checkboxes in the given lines are completed [x] or cancelled [-]
 */
function areAllCheckboxesComplete(lines: string[]): boolean {
  const checkboxRegex = /^\s*[-*]\s*\[(.)\]/
  let hasCheckboxes = false
  
  for (const line of lines) {
    const match = line.match(checkboxRegex)
    if (match) {
      hasCheckboxes = true
      const marker = match[1].toLowerCase()
      // [x] = complete, [-] = cancelled (both are "done")
      // [ ] = pending, [~] = in progress (not done)
      if (marker !== "x" && marker !== "-") {
        return false
      }
    }
  }
  
  // If no checkboxes, consider it complete (header-only phase)
  return hasCheckboxes
}

/**
 * Parse phases from plan content
 */
function parsePhases(lines: string[]): PhaseInfo[] {
  const phases: PhaseInfo[] = []
  const phaseStartRegex = /^(#{2,3})\s+Phase\s+\d+:/i
  const completedPhasesRegex = /^##\s+Completed\s+Phases/i
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Skip if this is the Completed Phases section
    if (completedPhasesRegex.test(line)) {
      break
    }
    
    if (phaseStartRegex.test(line)) {
      // Find phase end
      let endLine = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        // End at next phase header, --- separator, or Completed Phases
        if (phaseStartRegex.test(nextLine) || 
            nextLine.trim() === "---" ||
            completedPhasesRegex.test(nextLine)) {
          endLine = j
          break
        }
      }
      
      const phaseLines = lines.slice(i, endLine)
      phases.push({
        header: line,
        startLine: i,
        endLine,
        lines: phaseLines,
        isComplete: areAllCheckboxesComplete(phaseLines),
      })
    }
  }
  
  return phases
}

/**
 * Downgrade phase header from ## to ###
 */
function downgradeHeader(header: string): string {
  // ## Phase N: Name -> ### Phase N: Name
  if (header.startsWith("## ") && !header.startsWith("### ")) {
    return "#" + header
  }
  return header
}

/**
 * Find or create the Completed Phases section
 * Returns the line index where completed phases should be inserted
 */
function findCompletedPhasesSection(lines: string[]): { insertAt: number; sectionExists: boolean } {
  const completedPhasesRegex = /^##\s+Completed\s+Phases/i
  
  // Check if section already exists
  for (let i = 0; i < lines.length; i++) {
    if (completedPhasesRegex.test(lines[i])) {
      // Find the end of this section (next ## header or end of file)
      for (let j = i + 1; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j]) && !completedPhasesRegex.test(lines[j])) {
          return { insertAt: j, sectionExists: true }
        }
      }
      return { insertAt: lines.length, sectionExists: true }
    }
  }
  
  // Section doesn't exist - find last --- separator
  let lastSeparator = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "---") {
      lastSeparator = i
      break
    }
  }
  
  if (lastSeparator >= 0) {
    return { insertAt: lastSeparator + 1, sectionExists: false }
  }
  
  // No separator - insert at end with separator
  return { insertAt: lines.length, sectionExists: false }
}

/**
 * Reorganize a plan file by moving completed phases to the bottom.
 * 
 * @param planPath - Absolute path to the plan file
 * @returns true if any changes were made, false otherwise
 */
export function reorganizePlan(planPath: string): boolean {
  if (!existsSync(planPath)) {
    return false
  }
  
  const content = readFileSync(planPath, "utf-8")
  const lines = content.split(/\r?\n/)
  
  // Parse phases
  const phases = parsePhases(lines)
  
  // Find completed phases
  const completedPhases = phases.filter(p => p.isComplete)
  
  if (completedPhases.length === 0) {
    return false // No changes needed
  }
  
  // Build new content
  const newLines: string[] = []
  let currentIndex = 0
  
  // Copy lines, skipping completed phases
  for (const phase of phases) {
    // Add any lines before this phase
    while (currentIndex < phase.startLine) {
      newLines.push(lines[currentIndex])
      currentIndex++
    }
    
    if (!phase.isComplete) {
      // Keep incomplete phases in place
      for (const line of phase.lines) {
        newLines.push(line)
      }
    }
    currentIndex = phase.endLine
  }
  
  // Add remaining lines (after all phases, up to Completed Phases or end)
  const completedPhasesRegex = /^##\s+Completed\s+Phases/i
  while (currentIndex < lines.length) {
    const line = lines[currentIndex]
    if (completedPhasesRegex.test(line)) {
      break // Stop before existing Completed Phases section
    }
    newLines.push(line)
    currentIndex++
  }
  
  // Find where to insert completed phases
  const { insertAt, sectionExists } = findCompletedPhasesSection(newLines)
  
  // Build completed phases content
  const completedContent: string[] = []
  
  if (!sectionExists) {
    // Add separator if needed
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== "---") {
      completedContent.push("")
      completedContent.push("---")
    }
    completedContent.push("")
    completedContent.push("## Completed Phases")
  }
  
  completedContent.push("")
  
  for (const phase of completedPhases) {
    // Downgrade header and add phase content
    const downgradedHeader = downgradeHeader(phase.header)
    completedContent.push(downgradedHeader)
    for (let i = 1; i < phase.lines.length; i++) {
      completedContent.push(phase.lines[i])
    }
    completedContent.push("")
  }
  
  // Insert completed phases at the right position
  const finalLines = [
    ...newLines.slice(0, insertAt),
    ...completedContent,
    ...newLines.slice(insertAt),
  ]
  
  // Write back
  const newContent = finalLines.join("\n")
  
  // Only write if content changed
  if (newContent !== content) {
    writeFileSync(planPath, newContent, "utf-8")
    return true
  }
  
  return false
}
