import type { BeadsRuntimeTaskMetadata } from "../beads-runtime";
import type { BoulderRuntimeStateMetadata } from "./types";

const RUNTIME_VERSION = "3.16.0";
const RUNTIME_ATTACHMENT_REGISTRY_REF =
	".beads/artifacts/runtime-attachments/registry.schema-1.json";
const DURABLE_MANIFEST_REF = ".beads/artifacts/manifests/index.schema-1.json";

function getLastRebuildSource(
	beadsRuntime: BeadsRuntimeTaskMetadata,
): string | undefined {
	if (beadsRuntime.sourceCommand) {
		return beadsRuntime.sourceCommand;
	}

	if (beadsRuntime.attachState?.status === "attached") {
		return beadsRuntime.attachState.sourceCommand;
	}

	return undefined;
}

export function createBoulderRuntimeStateMetadata(
	beadsRuntime: BeadsRuntimeTaskMetadata,
	current?: BoulderRuntimeStateMetadata,
): BoulderRuntimeStateMetadata {
	const lastRebuildSource = getLastRebuildSource(beadsRuntime);

	return {
		schema_version: 1,
		runtime_role: "rebuildable-runtime-state",
		authoritative_source: "durable-beads-artifacts",
		producer: { name: "omo", version: RUNTIME_VERSION },
		runtime: { name: "oh-my-openagent", version: RUNTIME_VERSION },
		compatibility: {
			durable_truth: "beads-manifest-and-runtime-artifacts",
			runtime_state_conflict_policy: "durable-wins-mark-runtime-stale",
		},
		...(lastRebuildSource !== undefined
			? { last_rebuild_source: lastRebuildSource }
			: {}),
		last_durable_artifact_ref: RUNTIME_ATTACHMENT_REGISTRY_REF,
		last_durable_manifest_ref: DURABLE_MANIFEST_REF,
		...(beadsRuntime.lastReconciledAt !== undefined
			? { last_synced_at: beadsRuntime.lastReconciledAt }
			: current?.last_synced_at !== undefined
				? { last_synced_at: current.last_synced_at }
				: {}),
		...(current?.stale_reason !== undefined
			? { stale_reason: current.stale_reason }
			: {}),
		...(current?.stale_checked_at !== undefined
			? { stale_checked_at: current.stale_checked_at }
			: {}),
	};
}

export function markBoulderRuntimeStateStale(args: {
	current?: BoulderRuntimeStateMetadata;
	reason: string;
	checkedAt: string;
}): BoulderRuntimeStateMetadata {
	return {
		...(args.current ?? {
			schema_version: 1,
			runtime_role: "rebuildable-runtime-state",
			authoritative_source: "durable-beads-artifacts",
			producer: { name: "omo", version: RUNTIME_VERSION },
			runtime: { name: "oh-my-openagent", version: RUNTIME_VERSION },
			compatibility: {
				durable_truth: "beads-manifest-and-runtime-artifacts",
				runtime_state_conflict_policy: "durable-wins-mark-runtime-stale",
			},
			last_durable_artifact_ref: RUNTIME_ATTACHMENT_REGISTRY_REF,
			last_durable_manifest_ref: DURABLE_MANIFEST_REF,
		}),
		stale_reason: args.reason,
		stale_checked_at: args.checkedAt,
	};
}
