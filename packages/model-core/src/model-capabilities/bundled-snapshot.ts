import { SUPPLEMENTAL_MODEL_CAPABILITIES } from "./supplemental-entries"
import type { ModelCapabilitiesSnapshot } from "./types"

export function getBundledModelCapabilitiesSnapshot(
	snapshotJson: ModelCapabilitiesSnapshot,
): ModelCapabilitiesSnapshot {
	return {
		...snapshotJson,
		models: {
			...snapshotJson.models,
			...SUPPLEMENTAL_MODEL_CAPABILITIES,
		},
	}
}
