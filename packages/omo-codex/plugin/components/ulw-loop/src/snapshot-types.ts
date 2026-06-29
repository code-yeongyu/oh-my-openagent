import type { UlwLoopPlan } from "./types.js";

export interface SnapshotChangedFileEntry {
	readonly status: string;
	readonly path: string;
	readonly line: string;
}

export type SnapshotChangedFileSummary =
	| {
			readonly kind: "available";
			readonly entries: readonly SnapshotChangedFileEntry[];
			readonly truncated: boolean;
	  }
	| {
			readonly kind: "unavailable";
			readonly reason: string;
	  };

export interface RenderUlwLoopResumeSnapshotInput {
	readonly plan: UlwLoopPlan;
	readonly changedFiles: SnapshotChangedFileSummary;
	readonly evidenceItems?: readonly string[];
	readonly nextAction: string;
	readonly generatedAt?: string;
}
