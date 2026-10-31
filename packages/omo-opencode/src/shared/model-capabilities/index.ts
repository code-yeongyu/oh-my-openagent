import {
	getBundledModelCapabilitiesSnapshot,
	getModelCapabilities as getModelCapabilitiesFromCore,
} from "@oh-my-opencode/model-core"
import type { GetModelCapabilitiesInput, ModelCapabilities, ModelCapabilitiesSnapshot } from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "../connected-providers-cache"
import { log } from "../logger"
import { readModelCapabilitiesCache } from "../model-capabilities-cache"
import bundledModelCapabilitiesSnapshotJson from "../../generated/model-capabilities.generated.json"

export function getBundledModelCapabilitiesSnapshotForRuntime() {
	return getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
}

export function getBundledModelCapabilitiesSnapshotForShared(): ReturnType<typeof getBundledModelCapabilitiesSnapshotForRuntime> {
	return getBundledModelCapabilitiesSnapshotForRuntime()
}

export { getBundledModelCapabilitiesSnapshotForShared as getBundledModelCapabilitiesSnapshot }

let reportedRuntimeSnapshotProblem = false

function reportRuntimeSnapshotProblem(reason: string, details: Record<string, unknown> = {}): void {
	if (reportedRuntimeSnapshotProblem) return
	reportedRuntimeSnapshotProblem = true
	log(`[model-capabilities] runtime capability cache ignored: ${reason}`, details)
}

/**
 * The models.dev snapshot that `refresh-model-capabilities` and the startup
 * refresh write to model-capabilities.json. It is consulted before the bundled
 * snapshot, so models released after this build resolve from the refreshed
 * cache. A missing, malformed, or older-than-bundled cache is ignored.
 */
export function readRuntimeModelCapabilitiesSnapshot(
	read: () => ModelCapabilitiesSnapshot | null = readModelCapabilitiesCache,
	bundledGeneratedAt: string | undefined = bundledModelCapabilitiesSnapshotJson.generatedAt,
): ModelCapabilitiesSnapshot | undefined {
	let snapshot: ModelCapabilitiesSnapshot | null
	try {
		snapshot = read()
	} catch (error) {
		reportRuntimeSnapshotProblem("unreadable", { error: String(error) })
		return undefined
	}
	if (!snapshot) return undefined
	const models: unknown = (snapshot as { models?: unknown }).models
	if (typeof models !== "object" || models === null || Array.isArray(models)) {
		reportRuntimeSnapshotProblem("no models map")
		return undefined
	}
	const cacheTime = Date.parse(snapshot.generatedAt)
	const bundledTime = bundledGeneratedAt ? Date.parse(bundledGeneratedAt) : Number.NaN
	if (Number.isFinite(cacheTime) && Number.isFinite(bundledTime) && cacheTime < bundledTime) {
		reportRuntimeSnapshotProblem("older than the bundled snapshot", {
			cacheGeneratedAt: snapshot.generatedAt,
			bundledGeneratedAt,
		})
		return undefined
	}
	return snapshot
}

export function getModelCapabilities(input: GetModelCapabilitiesInput): ModelCapabilities {
  return getModelCapabilitiesFromCore({
    ...input,
    runtimeSnapshot: input.runtimeSnapshot ?? readRuntimeModelCapabilitiesSnapshot(),
    bundledSnapshot: input.bundledSnapshot ?? getBundledModelCapabilitiesSnapshotForRuntime(),
    providerCache: input.providerCache ?? connectedProvidersCache,
  })
}
export type {
  GetModelCapabilitiesInput,
  ModelCapabilities,
  ModelCapabilitiesDiagnostics,
  ModelCapabilitiesSnapshot,
  ModelCapabilitiesSnapshotEntry,
} from "@oh-my-opencode/model-core"
