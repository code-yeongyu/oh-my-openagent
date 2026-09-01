export const SUBAGENT_STOP_EVENT = "SubagentStop";

export type SubagentStopInput = {
	readonly hook_event_name: typeof SUBAGENT_STOP_EVENT;
	readonly agent_type: string;
	readonly agent_id: string;
	readonly session_id: string;
	readonly cwd: string;
	readonly transcript_path: string;
	readonly model: string;
	readonly permission_mode: string;
	readonly stop_hook_active: boolean;
	readonly turn_id?: string;
	readonly last_assistant_message?: string;
};

export type StopHookOutput = {
	readonly decision: "block";
	readonly reason: string;
};

export type FileStat = {
	readonly size: number;
	readonly isFile?: () => boolean;
	readonly isSymbolicLink?: () => boolean;
};

export type HookFileSystem = {
	existsSync(path: string): boolean;
	lstatSync?(path: string): FileStat;
	mkdirSync(path: string, options: { readonly recursive: true }): unknown;
	readFileSync(path: string, encoding: "utf8"): string;
	realpathSync?(path: string): string;
	renameSync(oldPath: string, newPath: string): void;
	rmSync(path: string, options: { readonly force: true; readonly recursive?: boolean }): void;
	statSync(path: string): FileStat;
	writeFileSync(path: string, data: string): void;
};
