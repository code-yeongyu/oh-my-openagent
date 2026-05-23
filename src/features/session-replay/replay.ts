import { ReplaySession, ReplayStep, SessionSnapshot, SessionDiff } from "./types"
import { getSnapshots, buildDecisionTree, getReplaySummary, listSessions } from "./storage"

const activeReplays = new Map<string, ReplaySession>()

export function startReplay(sessionId: string): ReplaySession {
  const snapshots = getSnapshots(sessionId)
  const replay: ReplaySession = {
    id: sessionId,
    snapshots,
    currentIndex: -1,
    totalSnapshots: snapshots.length,
  }
  activeReplays.set(sessionId, replay)
  return replay
}

export function nextStep(replayId: string): ReplayStep | null {
  const replay = activeReplays.get(replayId)
  if (!replay) return null

  const nextIndex = replay.currentIndex + 1
  if (nextIndex >= replay.totalSnapshots) return null

  replay.currentIndex = nextIndex
  const snapshot = replay.snapshots[nextIndex]

  const decisionTree = buildDecisionTree(replayId)

  return {
    snapshot,
    index: nextIndex,
    total: replay.totalSnapshots,
    canGoBack: nextIndex > 0,
    canGoForward: nextIndex < replay.totalSnapshots - 1,
    decisionTree: decisionTree ?? undefined,
  }
}

export function prevStep(replayId: string): ReplayStep | null {
  const replay = activeReplays.get(replayId)
  if (!replay) return null

  const prevIndex = replay.currentIndex - 1
  if (prevIndex < 0) return null

  replay.currentIndex = prevIndex
  const snapshot = replay.snapshots[prevIndex]
  const decisionTree = buildDecisionTree(replayId)

  return {
    snapshot,
    index: prevIndex,
    total: replay.totalSnapshots,
    canGoBack: prevIndex > 0,
    canGoForward: prevIndex < replay.totalSnapshots - 1,
    decisionTree: decisionTree ?? undefined,
  }
}

export function goToStep(replayId: string, index: number): ReplayStep | null {
  const replay = activeReplays.get(replayId)
  if (!replay) return null
  if (index < 0 || index >= replay.totalSnapshots) return null

  replay.currentIndex = index
  const snapshot = replay.snapshots[index]
  const decisionTree = buildDecisionTree(replayId)

  return {
    snapshot,
    index,
    total: replay.totalSnapshots,
    canGoBack: index > 0,
    canGoForward: index < replay.totalSnapshots - 1,
    decisionTree: decisionTree ?? undefined,
  }
}

export function getReplayState(replayId: string): ReplaySession | null {
  return activeReplays.get(replayId) ?? null
}

export function listReplayableSessions(): Array<{ sessionId: string; summary: ReturnType<typeof getReplaySummary> }> {
  const sessions = listSessions()
  return sessions.map(s => ({
    sessionId: s.sessionId,
    summary: getReplaySummary(s.sessionId),
  }))
}

export function computeDiff(snapshots: SessionSnapshot[]): SessionDiff[] {
  const diffs: SessionDiff[] = []

  for (let i = 1; i < snapshots.length; i++) {
    const current = snapshots[i]
    const previous = snapshots[i - 1]

    const changes: SessionDiff["changes"] = []

    if (current.eventType === "state_change" && current.stateDiff) {
      for (const [path, diff] of Object.entries(current.stateDiff)) {
        changes.push({ path, before: diff.before, after: diff.after })
      }
    }

    if (changes.length > 0) {
      diffs.push({
        snapshotId: current.id,
        sequence: current.sequence,
        eventType: current.eventType,
        changes,
      })
    }
  }

  return diffs
}

export function formatReplayStep(step: ReplayStep): string {
  const { snapshot, index, total } = step
  const lines: string[] = []

  lines.push(`[${index + 1}/${total}] ${snapshot.eventType.toUpperCase()}`)
  lines.push(`Agent: ${snapshot.agentName}`)
  lines.push(`Time: ${snapshot.timestamp.toISOString()}`)

  if (snapshot.toolName) lines.push(`Tool: ${snapshot.toolName}`)
  if (snapshot.decision) lines.push(`Decision: ${snapshot.decision}`)
  if (snapshot.reasoning) lines.push(`Reasoning: ${snapshot.reasoning}`)
  if (snapshot.durationMs != null) lines.push(`Duration: ${snapshot.durationMs}ms`)
  if (snapshot.error) lines.push(`Error: ${snapshot.error}`)
  if (snapshot.input) lines.push(`Input: ${JSON.stringify(snapshot.input).slice(0, 200)}`)
  if (snapshot.output) lines.push(`Output: ${JSON.stringify(snapshot.output).slice(0, 200)}`)

  if (step.canGoBack) lines.push("[b]ack |", "")
  if (step.canGoForward) lines.push("[f]orward |", "")
  lines.push("[q]uit")

  return lines.join("\n")
}
