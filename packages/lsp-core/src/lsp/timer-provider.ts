export type TimerHandle = ReturnType<typeof setTimeout>;

export interface TimerProvider {
	readonly now: () => number;
	readonly setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
	readonly clearTimeout: (handle: TimerHandle) => void;
}

export const realTimerProvider: TimerProvider = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimeout: (handle) => clearTimeout(handle),
};
