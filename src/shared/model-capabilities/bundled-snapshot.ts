import bundledModelCapabilitiesSnapshotJson from "../../generated/model-capabilities.generated.json"

import { SUPPLEMENTAL_MODEL_CAPABILITIES } from "./supplemental-entries"
import type { ModelCapabilitiesSnapshot } from "./types"

function normalizeSnapshot(
	snapshot: ModelCapabilitiesSnapshot | typeof bundledModelCapabilitiesSnapshotJson,
): ModelCapabilitiesSnapshot {
	return snapshot as ModelCapabilitiesSnapshot
}

const normalizedBundledSnapshot = normalizeSnapshot(bundledModelCapabilitiesSnapshotJson)

const bundledModelCapabilitiesSnapshot: ModelCapabilitiesSnapshot = {
	...normalizedBundledSnapshot,
	models: {
		...normalizedBundledSnapshot.models,
		...SUPPLEMENTAL_MODEL_CAPABILITIES,
	},
}

export function getBundledModelCapabilitiesSnapshot(): ModelCapabilitiesSnapshot {
	return bundledModelCapabilitiesSnapshot
}
