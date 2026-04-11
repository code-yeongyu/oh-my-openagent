import type { BeadsRuntimeTaskMetadata } from "../beads-runtime";
import {
	getBoulderBeadsRuntimeMetadata,
	readBoulderState,
} from "../boulder-state";

interface BeadsRuntimeParentTaskLookup {
	findBySession?: (
		sessionID: string,
	) => { beadsRuntime?: BeadsRuntimeTaskMetadata } | undefined;
}

export function resolveInheritedBeadsRuntime(args: {
	manager: BeadsRuntimeParentTaskLookup;
	directory?: string;
	parentSessionID: string;
	currentBeadsRuntime?: BeadsRuntimeTaskMetadata;
}): BeadsRuntimeTaskMetadata | undefined {
	const { manager, directory, parentSessionID, currentBeadsRuntime } = args;

	if (currentBeadsRuntime?.beadID) {
		return { ...currentBeadsRuntime };
	}

	const parentTask = manager.findBySession?.(parentSessionID);
	if (parentTask?.beadsRuntime?.beadID) {
		return { ...parentTask.beadsRuntime };
	}

	if (!directory) {
		return undefined;
	}

	const boulderState = readBoulderState(directory);
	if (!boulderState?.session_ids?.includes(parentSessionID)) {
		return undefined;
	}

	const inherited = getBoulderBeadsRuntimeMetadata(boulderState);
	return inherited ? { ...inherited } : undefined;
}
