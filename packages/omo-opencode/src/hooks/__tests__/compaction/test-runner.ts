/**
 * Test runner with timeout handling, caching, and parallel execution
 */

import { createHash } from "crypto"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs"
import { join } from "path"
import OpenAI from "openai"

/**
 * Test mode configuration
 */
export enum TestMode {
  QUICK = "quick", // 1 model, 8 facts, < 2 min
  STANDARD = "standard", // 3 models, 8 facts, < 5 min
  FULL = "full", // 3 models, 100 facts, < 30 min
  STRESS = "stress", // 3 models, 200 facts, < 60 min
}

/**
 * Test mode configuration
 */
export const TEST_MODE_CONFIG: Record<TestMode, {
  models: number
  facts: number
  timeout: number // milliseconds
  description: string
}> = {
  [TestMode.QUICK]: {
    models: 1,
    facts: 8,
    timeout: 120000, // 2 minutes
    description: "Quick test for CI/CD",
  },
  [TestMode.STANDARD]: {
    models: 3,
    facts: 8,
    timeout: 300000, // 5 minutes
    description: "Standard test for daily development",
  },
  [TestMode.FULL]: {
    models: 3,
    facts: 100,
    timeout: 1800000, // 30 minutes
    description: "Full test for pre-release validation",
  },
  [TestMode.STRESS]: {
    models: 3,
    facts: 200,
    timeout: 3600000, // 60 minutes
    description: "Stress test for performance benchmarking",
  },
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
  summary: string
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  promptVersion: string
}

/**
 * Test progress structure
 */
export interface TestProgress {
  completedModels: string[]
  completedFacts: Record<string, string[]>
  lastUpdated: number
  testMode: TestMode
}

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  directory: ".cache/compaction",
  maxSizeBytes: 1024 * 1024 * 1024, // 1GB
  maxAgeDays: 30,
  progressFile: ".cache/test-progress.json",
}

/**
 * API timeout configuration
 */
export const API_TIMEOUT_CONFIG = {
  singleCall: 30000, // 30 seconds
  testCase: 120000, // 2 minutes
  maxRetries: 3,
  initialBackoff: 1000, // 1 second
  maxBackoff: 60000, // 60 seconds
}

/**
 * Generate cache key from conversation
 */
export function generateCacheKey(conversation: string, model: string, promptVersion: string): string {
  const content = `${conversation}|${model}|${promptVersion}`
  return createHash("md5").update(content).digest("hex")
}

/**
 * Get cache directory path
 */
export function getCacheDirectory(): string {
  return CACHE_CONFIG.directory
}

/**
 * Ensure cache directory exists
 */
export function ensureCacheDirectory(): void {
  const cacheDir = getCacheDirectory()
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
}

/**
 * Get cache entry
 */
export function getCacheEntry(cacheKey: string): CacheEntry | null {
  ensureCacheDirectory()
  const cachePath = join(getCacheDirectory(), `${cacheKey}.json`)

  if (!existsSync(cachePath)) {
    return null
  }

  try {
    const content = readFileSync(cachePath, "utf-8")
    return JSON.parse(content) as CacheEntry
  } catch (error) {
    console.warn(`Failed to read cache entry: ${cacheKey}`, error)
    return null
  }
}

/**
 * Save cache entry
 */
export function saveCacheEntry(cacheKey: string, entry: CacheEntry): void {
  ensureCacheDirectory()
  const cachePath = join(getCacheDirectory(), `${cacheKey}.json`)

  try {
    writeFileSync(cachePath, JSON.stringify(entry, null, 2))
  } catch (error) {
    console.warn(`Failed to save cache entry: ${cacheKey}`, error)
  }
}

/**
 * Check if cache entry is valid (not expired)
 */
export function isCacheEntryValid(entry: CacheEntry): boolean {
  const now = Date.now()
  const ageMs = now - entry.timestamp
  const maxAgeMs = CACHE_CONFIG.maxAgeDays * 24 * 60 * 60 * 1000
  return ageMs < maxAgeMs
}

/**
 * Get cached summary or compress conversation
 */
export async function getCachedOrCompress(
  client: OpenAI,
  modelId: string,
  conversation: string,
  compressFn: (client: OpenAI, modelId: string, conversation: string) => Promise<{
    summary: string
    inputTokens: number
    outputTokens: number
  }>,
  promptVersion: string
): Promise<{ summary: string; fromCache: boolean }> {
  const cacheKey = generateCacheKey(conversation, modelId, promptVersion)
  const cached = getCacheEntry(cacheKey)

  if (cached && isCacheEntryValid(cached)) {
    console.log(`Cache hit: ${cacheKey}`)
    return { summary: cached.summary, fromCache: true }
  }

  console.log(`Cache miss: ${cacheKey}`)
  const result = await compressFn(client, modelId, conversation)

  const entry: CacheEntry = {
    summary: result.summary,
    timestamp: Date.now(),
    model: modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    promptVersion,
  }

  saveCacheEntry(cacheKey, entry)
  return { summary: result.summary, fromCache: false }
}

/**
 * Get total cache size in bytes
 */
export function getCacheSize(): number {
  const cacheDir = getCacheDirectory()
  if (!existsSync(cacheDir)) {
    return 0
  }

  let totalSize = 0
  const files = readdirSync(cacheDir)

  for (const file of files) {
    const filePath = join(cacheDir, file)
    const stats = statSync(filePath)
    totalSize += stats.size
  }

  return totalSize
}

/**
 * Clean old cache entries
 */
export function cleanCache(): { deleted: number; freedBytes: number } {
  const cacheDir = getCacheDirectory()
  if (!existsSync(cacheDir)) {
    return { deleted: 0, freedBytes: 0 }
  }

  const now = Date.now()
  const maxAgeMs = CACHE_CONFIG.maxAgeDays * 24 * 60 * 60 * 1000
  let deleted = 0
  let freedBytes = 0

  const files = readdirSync(cacheDir)

  for (const file of files) {
    const filePath = join(cacheDir, file)
    const stats = statSync(filePath)
    const ageMs = now - stats.mtimeMs

    if (ageMs > maxAgeMs) {
      freedBytes += stats.size
      unlinkSync(filePath)
      deleted++
    }
  }

  // If still over size limit, delete oldest files
  if (getCacheSize() > CACHE_CONFIG.maxSizeBytes) {
    const filesWithStats = files.map((file) => {
      const filePath = join(cacheDir, file)
      return { file, path: filePath, stats: statSync(filePath) }
    })

    filesWithStats.sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs)

    for (const { path, stats } of filesWithStats) {
      if (getCacheSize() <= CACHE_CONFIG.maxSizeBytes) {
        break
      }
      freedBytes += stats.size
      unlinkSync(path)
      deleted++
    }
  }

  return { deleted, freedBytes }
}

/**
 * Load test progress
 */
export function loadTestProgress(): TestProgress | null {
  const progressPath = CACHE_CONFIG.progressFile

  if (!existsSync(progressPath)) {
    return null
  }

  try {
    const content = readFileSync(progressPath, "utf-8")
    return JSON.parse(content) as TestProgress
  } catch (error) {
    console.warn("Failed to load test progress", error)
    return null
  }
}

/**
 * Save test progress
 */
export function saveTestProgress(progress: TestProgress): void {
  const progressDir = join(CACHE_CONFIG.progressFile, "..")
  if (!existsSync(progressDir)) {
    mkdirSync(progressDir, { recursive: true })
  }

  try {
    writeFileSync(CACHE_CONFIG.progressFile, JSON.stringify(progress, null, 2))
  } catch (error) {
    console.warn("Failed to save test progress", error)
  }
}

/**
 * Create initial test progress
 */
export function createTestProgress(testMode: TestMode): TestProgress {
  return {
    completedModels: [],
    completedFacts: {},
    lastUpdated: Date.now(),
    testMode,
  }
}

/**
 * Check if test should be skipped (already completed)
 */
export function shouldSkipTest(
  progress: TestProgress | null,
  modelId: string,
  factId: string
): boolean {
  if (!progress) {
    return false
  }

  if (progress.completedModels.includes(modelId)) {
    return true
  }

  const completedFacts = progress.completedFacts[modelId] || []
  return completedFacts.includes(factId)
}

/**
 * Mark test as completed
 */
export function markTestCompleted(
  progress: TestProgress,
  modelId: string,
  factId: string
): void {
  if (!progress.completedFacts[modelId]) {
    progress.completedFacts[modelId] = []
  }

  if (!progress.completedFacts[modelId].includes(factId)) {
    progress.completedFacts[modelId].push(factId)
  }

  progress.lastUpdated = Date.now()
  saveTestProgress(progress)
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = API_TIMEOUT_CONFIG.maxRetries,
  initialBackoff: number = API_TIMEOUT_CONFIG.initialBackoff
): Promise<T> {
  let lastError: Error | null = null
  let backoff = initialBackoff

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt < maxRetries - 1) {
        console.warn(`Attempt ${attempt + 1} failed, retrying in ${backoff}ms...`)
        await sleep(backoff)
        backoff = Math.min(backoff * 2, API_TIMEOUT_CONFIG.maxBackoff)
      }
    }
  }

  throw lastError || new Error("All retry attempts failed")
}

/**
 * Execute with timeout
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string = "Operation timed out"
): Promise<T> {
  let timeoutId: NodeJS.Timeout

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(), timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

/**
 * Check if error is rate limit error
 */
export function isRateLimitError(error: any): boolean {
  return error?.status === 429 || error?.message?.includes("rate limit")
}

/**
 * Extract retry-after header from rate limit error
 */
export function extractRetryAfter(error: any): number {
  const retryAfter = error?.headers?.["retry-after"]
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }
  return 1000 // Default 1 second
}

/**
 * Handle rate limit with retry
 */
export async function handleRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (isRateLimitError(error)) {
        const retryAfter = extractRetryAfter(error)
        console.warn(`Rate limit hit, waiting ${retryAfter}ms before retry...`)
        await sleep(retryAfter)
        lastError = error as Error
      } else {
        throw error
      }
    }
  }

  throw lastError || new Error("Rate limit retries exhausted")
}
