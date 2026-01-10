/**
 * NPM registry interaction for version information
 */

import type { DistTags, ReleaseChannel } from "./types"
import { mapChannelToDistTag } from "./channels"
import { log } from "../logger"

const PACKAGE_NAME = "oh-my-opencode"
const REGISTRY_URL = `https://registry.npmjs.org/-/package/${PACKAGE_NAME}/dist-tags`
const FETCH_TIMEOUT = 5000

/**
 * Fetch all dist-tags from npm registry
 */
export async function fetchDistTags(): Promise<DistTags | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const response = await fetch(REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    if (!response.ok) {
      log(`[version/registry] Failed to fetch dist-tags: ${response.status}`)
      return null
    }

    const data = (await response.json()) as DistTags
    log(`[version/registry] Fetched dist-tags:`, Object.keys(data).join(", "))
    return data
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      log(`[version/registry] Fetch timeout after ${FETCH_TIMEOUT}ms`)
    } else {
      log(`[version/registry] Fetch error:`, err)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Get the latest version for a specific channel
 */
export async function getLatestForChannel(channel: ReleaseChannel): Promise<string | null> {
  const tags = await fetchDistTags()
  if (!tags) return null

  const tag = mapChannelToDistTag(channel)
  return tags[tag] ?? null
}

/**
 * Get the latest stable version
 */
export async function getLatestStable(): Promise<string | null> {
  const tags = await fetchDistTags()
  return tags?.latest ?? null
}

/**
 * Get the latest beta version
 */
export async function getLatestBeta(): Promise<string | null> {
  const tags = await fetchDistTags()
  return tags?.beta ?? null
}

/**
 * Check if a specific version exists as a dist-tag
 */
export async function isDistTagVersion(version: string): Promise<boolean> {
  const tags = await fetchDistTags()
  if (!tags) return false

  return Object.values(tags).includes(version)
}

/**
 * Get all available dist-tag names
 */
export async function getAvailableDistTags(): Promise<string[]> {
  const tags = await fetchDistTags()
  if (!tags) return []

  return Object.keys(tags)
}
