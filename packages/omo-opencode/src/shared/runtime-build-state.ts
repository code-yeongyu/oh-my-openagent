import { existsSync, readFileSync } from "node:fs"
import { getRuntimeBuildInfo } from "./runtime-build-info"

export type RuntimeBuildState = {
  build_id: string
  build_timestamp: string
  latest_build_id?: string
  latest_build_timestamp?: string
  stale_runtime_detected?: boolean
}

export function getRuntimeBuildState(): RuntimeBuildState {
  const embedded = getRuntimeBuildInfo()
  const latest = readLatestBuildInfo()
  if (!latest) {
    return embedded
  }

  return {
    ...embedded,
    latest_build_id: latest.build_id,
    latest_build_timestamp: latest.build_timestamp,
    stale_runtime_detected: latest.build_id !== embedded.build_id,
  }
}

function readLatestBuildInfo(): { build_id: string; build_timestamp: string } | null {
  try {
    const filePath = ".sisyphus/runtime-build-info.json"
    if (!existsSync(filePath)) {
      return null
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8"))
    if (typeof parsed.build_id !== "string" || typeof parsed.build_timestamp !== "string") {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
