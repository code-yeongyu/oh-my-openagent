/**
 * Retry Tracker
 * 
 * Tracks retry counts for blocked tasks to prevent infinite continuation loops.
 * Uses in-memory storage with optional file persistence.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { BOULDER_DIR } from "./constants"

const RETRY_STATE_FILE = "retry-state.json"
const DEFAULT_MAX_RETRIES = 3

interface RetryState {
  [taskId: string]: {
    count: number
    lastAttempt: string
    reason?: string
  }
}

/**
 * Get the retry state file path
 */
function getRetryStatePath(directory: string): string {
  return join(directory, BOULDER_DIR, RETRY_STATE_FILE)
}

/**
 * Read retry state from file
 */
function readRetryState(directory: string): RetryState {
  const filePath = getRetryStatePath(directory)
  
  if (!existsSync(filePath)) {
    return {}
  }
  
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as RetryState
  } catch {
    return {}
  }
}

/**
 * Write retry state to file
 */
function writeRetryState(directory: string, state: RetryState): boolean {
  const filePath = getRetryStatePath(directory)
  
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Increment retry count for a task
 * @returns The new retry count
 */
export function incrementRetry(directory: string, taskId: string, reason?: string): number {
  const state = readRetryState(directory)
  
  const current = state[taskId] || { count: 0, lastAttempt: "" }
  current.count++
  current.lastAttempt = new Date().toISOString()
  if (reason) {
    current.reason = reason
  }
  
  state[taskId] = current
  writeRetryState(directory, state)
  
  return current.count
}

/**
 * Check if a task has reached max retries
 */
export function isMaxRetries(directory: string, taskId: string, max: number = DEFAULT_MAX_RETRIES): boolean {
  const state = readRetryState(directory)
  const current = state[taskId]
  
  if (!current) return false
  return current.count >= max
}

/**
 * Get the current retry count for a task
 */
export function getRetryCount(directory: string, taskId: string): number {
  const state = readRetryState(directory)
  return state[taskId]?.count ?? 0
}

/**
 * Reset retry count for a task
 */
export function resetRetry(directory: string, taskId: string): void {
  const state = readRetryState(directory)
  delete state[taskId]
  writeRetryState(directory, state)
}

/**
 * Reset all retry counts
 */
export function resetAllRetries(directory: string): void {
  writeRetryState(directory, {})
}

/**
 * Get all blocked tasks (tasks that have reached max retries)
 */
export function getBlockedTasks(directory: string, max: number = DEFAULT_MAX_RETRIES): string[] {
  const state = readRetryState(directory)
  
  return Object.entries(state)
    .filter(([_, data]) => data.count >= max)
    .map(([taskId]) => taskId)
}

/**
 * Get retry info for a specific task
 */
export function getRetryInfo(directory: string, taskId: string): { count: number; lastAttempt: string; reason?: string } | null {
  const state = readRetryState(directory)
  return state[taskId] ?? null
}
