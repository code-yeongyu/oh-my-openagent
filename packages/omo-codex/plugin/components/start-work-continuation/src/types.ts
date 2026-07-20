export const STOP_HOOK_EVENTS = ["Stop", "SubagentStop"] as const;
export type StopHookEventName = (typeof STOP_HOOK_EVENTS)[number];

export type StopInput = {
	readonly hook_event_name: StopHookEventName;
	readonly session_id: string;
	readonly turn_id: string;
	readonly transcript_path: string;
	readonly cwd: string;
	readonly model: string;
	readonly permission_mode: string;
	readonly stop_hook_active: boolean;
	readonly last_assistant_message?: string;
};

export type StopHookOutput = {
	readonly decision: "block";
	readonly reason: string;
};

export type ReadonlyFileSystem = {
	lstatSync(path: string): ReadonlyFileStat;
	readFileSync(path: string, encoding: "utf8"): string;
};

export type ReadonlyFileStat = {
	readonly size: number;
	isFile(): boolean;
};
