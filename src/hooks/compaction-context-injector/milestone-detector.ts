export type MilestoneType = "completion" | "phase-transition" | "none"

export interface MilestoneResult {
  detected: boolean
  type: MilestoneType
  keyword?: string
  phase?: string
}

export interface CompactionSuggestion {
  shouldSuggest: boolean
  reason?: string
  milestone?: MilestoneResult
}

interface SessionState {
  suggestionCount: number
  rejected: boolean
}

const COMPLETION_KEYWORDS = {
  en: ["done", "finished", "completed"],
  zh: ["完成", "已完成"],
}

const PHASE_KEYWORDS = {
  en: ["phase complete"],
  zh: ["阶段完成"],
}

const MAX_SUGGESTIONS_PER_SESSION = 3

export function detectMilestone(text: string): MilestoneResult {
  const lowerText = text.toLowerCase()

  // Check for phase transitions with number (e.g., "Phase 1 完成", "Phase 2 done")
  const phaseNumberPattern = /phase\s+(\d+)\s+(done|完成|finished|completed|complete)/i
  const phaseMatch = text.match(phaseNumberPattern)
  if (phaseMatch) {
    return {
      detected: true,
      type: "phase-transition",
      keyword: phaseMatch[2].toLowerCase(),
      phase: phaseMatch[1],
    }
  }

  // Check for general phase completion keywords
  for (const keyword of PHASE_KEYWORDS.en) {
    if (lowerText.includes(keyword)) {
      return {
        detected: true,
        type: "phase-transition",
        keyword,
      }
    }
  }

  for (const keyword of PHASE_KEYWORDS.zh) {
    if (text.includes(keyword)) {
      return {
        detected: true,
        type: "phase-transition",
        keyword,
      }
    }
  }

  // Check for completion keywords (English - case insensitive)
  for (const keyword of COMPLETION_KEYWORDS.en) {
    if (lowerText.includes(keyword)) {
      return {
        detected: true,
        type: "completion",
        keyword,
      }
    }
  }

  // Check for completion keywords (Chinese - case sensitive)
  for (const keyword of COMPLETION_KEYWORDS.zh) {
    if (text.includes(keyword)) {
      return {
        detected: true,
        type: "completion",
        keyword,
      }
    }
  }

  return {
    detected: false,
    type: "none",
  }
}

export function createMilestoneDetector() {
  const sessionStates = new Map<string, SessionState>()

  function getSessionState(sessionId: string): SessionState {
    if (!sessionStates.has(sessionId)) {
      sessionStates.set(sessionId, {
        suggestionCount: 0,
        rejected: false,
      })
    }
    return sessionStates.get(sessionId)!
  }

  function shouldSuggestCompaction(sessionId: string, text: string): CompactionSuggestion {
    const milestone = detectMilestone(text)
    const state = getSessionState(sessionId)

    // No milestone detected
    if (!milestone.detected) {
      return {
        shouldSuggest: false,
        milestone,
      }
    }

    // User has rejected suggestions for this session
    if (state.rejected) {
      return {
        shouldSuggest: false,
        milestone,
        reason: "User previously rejected compaction suggestions for this session",
      }
    }

    // Max suggestions limit reached
    if (state.suggestionCount >= MAX_SUGGESTIONS_PER_SESSION) {
      return {
        shouldSuggest: false,
        milestone,
        reason: `Maximum ${MAX_SUGGESTIONS_PER_SESSION} suggestions per session reached`,
      }
    }

    // Increment suggestion count and suggest compaction
    state.suggestionCount++

    const reasonMap: Record<MilestoneType, string> = {
      completion: `Detected completion keyword: "${milestone.keyword}"`,
      "phase-transition": milestone.phase
        ? `Detected phase ${milestone.phase} transition`
        : "Detected phase transition",
      none: "",
    }

    return {
      shouldSuggest: true,
      milestone,
      reason: reasonMap[milestone.type],
    }
  }

  function markRejected(sessionId: string): void {
    const state = getSessionState(sessionId)
    state.rejected = true
  }

  function resetSession(sessionId: string): void {
    sessionStates.delete(sessionId)
  }

  return {
    shouldSuggestCompaction,
    markRejected,
    resetSession,
  }
}
