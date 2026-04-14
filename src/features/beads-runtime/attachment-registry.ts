import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getPlanProgress, readBoulderState } from "../boulder-state";

const BEADS_RUNTIME_ATTACHMENT_REGISTRY = join(
	".beads",
	"artifacts",
	"runtime-attachments",
	"registry.schema-1.json",
);
const LEGACY_BEADS_RUNTIME_ATTACHMENT_REGISTRY = join(
	".beads",
	"artifacts",
	"runtime-attachments.json",
);
const ARTIFACTS_SCHEMA_VERSION = 1;
const RUNTIME_PRODUCER = {
	name: "oh-my-openagent",
	version: "3.16.0",
};

export interface BeadsRuntimeAttachmentRecord {
	beadID: string;
	continuationKey: string;
	continuationDirectory: string;
	activePlan: string;
	startedAt: string;
	sourceCommand: string;
	worktreePath: string;
	attachedAt: string;
	branchName?: string;
	worktreeName?: string;
}

export function getBeadsRuntimeAttachmentRegistryPath(
	directory: string,
): string {
	return join(directory, BEADS_RUNTIME_ATTACHMENT_REGISTRY);
}

function getLegacyBeadsRuntimeAttachmentRegistryPath(
	directory: string,
): string {
	return join(directory, LEGACY_BEADS_RUNTIME_ATTACHMENT_REGISTRY);
}

export function readBeadsRuntimeAttachmentRegistry(
	directory: string,
): Record<string, BeadsRuntimeAttachmentRecord> {
	const filePath = getBeadsRuntimeAttachmentRegistryPath(directory);
	if (existsSync(filePath)) {
		try {
			const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return {};
			}

			const wrappedAttachments = (parsed as Record<string, unknown>)
				.attachments;
			if (
				wrappedAttachments &&
				typeof wrappedAttachments === "object" &&
				!Array.isArray(wrappedAttachments)
			) {
				return wrappedAttachments as Record<
					string,
					BeadsRuntimeAttachmentRecord
				>;
			}

			if (
				typeof (parsed as Record<string, unknown>).schemaVersion === "number"
			) {
				return {};
			}

			return parsed as Record<string, BeadsRuntimeAttachmentRecord>;
		} catch {
			return {};
		}
	}

	const legacyPath = getLegacyBeadsRuntimeAttachmentRegistryPath(directory);
	if (!existsSync(legacyPath)) {
		return {};
	}

	try {
		const legacyParsed = JSON.parse(readFileSync(legacyPath, "utf-8"));
		if (
			!legacyParsed ||
			typeof legacyParsed !== "object" ||
			Array.isArray(legacyParsed)
		) {
			return {};
		}

		return legacyParsed as Record<string, BeadsRuntimeAttachmentRecord>;
	} catch {
		return {};
	}
}

function createRegistryPayload(
	registry: Record<string, BeadsRuntimeAttachmentRecord>,
): Record<string, unknown> {
	const writtenAt = new Date().toISOString();
	return {
		schemaVersion: ARTIFACTS_SCHEMA_VERSION,
		producer: {
			name: "omo",
			version: RUNTIME_PRODUCER.version,
		},
		runtime: RUNTIME_PRODUCER,
		writtenAt,
		attachments: registry,
	};
}

export function getBeadsRuntimeAttachmentProvenance(): Record<
	string,
	string | number
> {
	return {
		schemaVersion: ARTIFACTS_SCHEMA_VERSION,
		producer: "omo",
		runtimeVersion: RUNTIME_PRODUCER.version,
	};
}

export function writeBeadsRuntimeAttachmentRegistry(
	directory: string,
	registry: Record<string, BeadsRuntimeAttachmentRecord>,
): void {
	const filePath = getBeadsRuntimeAttachmentRegistryPath(directory);
	const parentDir = dirname(filePath);
	if (!existsSync(parentDir)) {
		mkdirSync(parentDir, { recursive: true });
	}

	writeFileSync(
		filePath,
		JSON.stringify(createRegistryPayload(registry), null, 2),
		"utf-8",
	);
}

export function isBeadsRuntimeAttachmentActive(
	record: BeadsRuntimeAttachmentRecord,
): boolean {
	const state = readBoulderState(record.continuationDirectory);
	if (!state) {
		return false;
	}

	if (
		state.active_plan !== record.activePlan ||
		state.started_at !== record.startedAt
	) {
		return false;
	}

	if (state.bead_id !== record.beadID) {
		return false;
	}

	return !getPlanProgress(state.active_plan).isComplete;
}

export function pruneInactiveBeadsRuntimeAttachments(
	directory: string,
): Record<string, BeadsRuntimeAttachmentRecord> {
	const registry = readBeadsRuntimeAttachmentRegistry(directory);
	const activeEntries = Object.entries(registry).filter(([, record]) => {
		return isBeadsRuntimeAttachmentActive(record);
	});
	const normalized = Object.fromEntries(activeEntries);

	if (activeEntries.length !== Object.keys(registry).length) {
		writeBeadsRuntimeAttachmentRegistry(directory, normalized);
	}

	return normalized;
}
