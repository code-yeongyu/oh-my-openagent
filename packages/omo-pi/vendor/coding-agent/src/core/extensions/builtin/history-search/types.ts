export type HistoryEntry = {
	readonly text: string;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly cwd: string;
	readonly timestamp: number;
};
