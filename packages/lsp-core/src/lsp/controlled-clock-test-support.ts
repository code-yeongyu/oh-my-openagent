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

interface ScheduleWaiter {
	readonly count: number;
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
	private readonly scheduleWaiters = new Set<ScheduleWaiter>();
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
		for (const waiter of this.scheduleWaiters) {
			if (this.scheduledDelays.length >= waiter.count) {
				this.scheduleWaiters.delete(waiter);
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

	/**
	 * Resolves once this clock has been asked to schedule `count` timers in total.
	 *
	 * Timer DELAYS are ambiguous whenever the code under test derives several budgets from the same
	 * remaining window (an LSP request timeout and the push-fallback wait are both "whatever is left
	 * of the freshness window"). The schedule ORDER is not ambiguous: a step that only runs after an
	 * earlier request settled can only arm its timer once that request's own timer was cleared. So a
	 * test that must fire the LATER timer waits for the later schedule instead of a delay value, and
	 * never races the earlier one.
	 */
	waitForScheduled(count: number): Promise<void> {
		if (this.scheduledDelays.length >= count) return Promise.resolve();
		return new Promise((resolve) => {
			this.scheduleWaiters.add({ count, resolve });
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
