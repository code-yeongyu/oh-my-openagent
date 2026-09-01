import type { TimerProvider } from "./timer-provider.js";

interface ControlledTimer {
	readonly at: number;
	readonly callback: () => void;
	cancelled: boolean;
}

interface TimerWaiter {
	readonly delayMs: number | undefined;
	readonly resolve: () => void;
}

/**
 * Deterministic TimerProvider for tests: timers fire only through advanceBy(),
 * and waitForTimer(delayMs) resolves once a timer with exactly that delay is
 * scheduled, so tests order themselves behind the timer they intend to fire.
 */
export class ControlledClock implements TimerProvider {
	private readonly timers: ControlledTimer[] = [];
	private currentTime = 0;
	private readonly timerWaiters = new Set<TimerWaiter>();
	readonly scheduledDelays: number[] = [];

	readonly now = (): number => this.currentTime;
	readonly setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
		const timer: ControlledTimer = { at: this.currentTime + delayMs, callback, cancelled: false };
		this.scheduledDelays.push(delayMs);
		this.timers.push(timer);
		for (const waiter of this.timerWaiters) {
			if (waiter.delayMs === undefined || waiter.delayMs === delayMs) {
				this.timerWaiters.delete(waiter);
				waiter.resolve();
			}
		}
		return timer as unknown as ReturnType<typeof setTimeout>;
	};
	readonly clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
		(handle as unknown as { cancelled: boolean }).cancelled = true;
	};

	waitForTimer(delayMs?: number): Promise<void> {
		const hasTimer = this.timers.some(
			(timer) => !timer.cancelled && (delayMs === undefined || timer.at === this.currentTime + delayMs),
		);
		if (hasTimer) return Promise.resolve();
		return new Promise((resolve) => {
			this.timerWaiters.add({ delayMs, resolve });
		});
	}

	advanceBy(delayMs: number): void {
		this.currentTime += delayMs;
		for (;;) {
			const index = this.timers.findIndex((timer) => timer.at <= this.currentTime);
			if (index < 0) return;
			const timer = this.timers.splice(index, 1)[0];
			if (timer && !timer.cancelled) timer.callback();
		}
	}
}
