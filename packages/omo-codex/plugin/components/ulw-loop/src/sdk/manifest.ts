export const ULW_LOOP_OPERATIONS = [
	"help",
	"create-goals",
	"status",
	"complete-goals",
	"checkpoint",
	"steer",
	"add-goal",
	"criteria",
	"record-evidence",
	"record-review-blockers",
] as const;

export type UlwLoopOperation = (typeof ULW_LOOP_OPERATIONS)[number];

export interface ToolkitOperationManifest {
	readonly name: UlwLoopOperation;
	readonly mutating: boolean;
}

export interface ToolkitManifest {
	readonly version: 1;
	readonly name: "ulw-loop";
	readonly operations: readonly ToolkitOperationManifest[];
}

export const ULW_LOOP_MANIFEST = {
	version: 1,
	name: "ulw-loop",
	operations: [
		{ name: "help", mutating: false },
		{ name: "create-goals", mutating: true },
		{ name: "status", mutating: false },
		{ name: "complete-goals", mutating: true },
		{ name: "checkpoint", mutating: true },
		{ name: "steer", mutating: true },
		{ name: "add-goal", mutating: true },
		{ name: "criteria", mutating: false },
		{ name: "record-evidence", mutating: true },
		{ name: "record-review-blockers", mutating: true },
	] satisfies readonly ToolkitOperationManifest[],
} satisfies ToolkitManifest;
