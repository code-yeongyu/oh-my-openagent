import bundledModelCapabilitiesSnapshotJson from "../../generated/model-capabilities.generated.json"

import type { ModelCapabilitiesSnapshot } from "./types"

function normalizeSnapshot(
	snapshot: ModelCapabilitiesSnapshot | typeof bundledModelCapabilitiesSnapshotJson,
): ModelCapabilitiesSnapshot {
	return snapshot as ModelCapabilitiesSnapshot
}

const bundledModelCapabilitiesSnapshot = normalizeSnapshot(bundledModelCapabilitiesSnapshotJson)

export function getBundledModelCapabilitiesSnapshot(): ModelCapabilitiesSnapshot {
	return bundledModelCapabilitiesSnapshot
}
