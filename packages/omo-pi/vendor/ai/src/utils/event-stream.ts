import type { AssistantMessage, AssistantMessageEvent } from "../types.ts";

// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
	#queue: T[] = [];
	#queueHead = 0;
	private waiting: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
	private done = false;
	#failed = false;
	#error: unknown;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private rejectFinalResult!: (error: unknown) => void;
	private isComplete: (event: T) => boolean;
	private extractResult: (event: T) => R;

	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve, reject) => {
			this.resolveFinalResult = resolve;
			this.rejectFinalResult = reject;
		});
		this.finalResultPromise.catch(() => {});
	}

	get queue(): T[] {
		return this.#queue.slice(this.#queueHead);
	}

	#enqueue(event: T): void {
		this.#queue.push(event);
	}

	#dequeue(): T {
		const event = this.#queue[this.#queueHead];
		if (event === undefined) {
			throw new Error("EventStream queue underflow");
		}
		this.#queueHead++;
		if (this.#queueHead > 1024 && this.#queueHead * 2 >= this.#queue.length) {
			this.#queue = this.#queue.slice(this.#queueHead);
			this.#queueHead = 0;
		}
		return event;
	}

	push(event: T): void {
		if (this.done) return;

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		// Deliver to waiting consumer or queue it
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter.resolve({ value: event, done: false });
		} else {
			this.#enqueue(event);
		}
	}

	end(result?: R): void {
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		// Notify all waiting consumers that we're done
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift();
			if (waiter) waiter.resolve({ value: undefined, done: true });
		}
	}

	fail(error: unknown): void {
		if (this.done) return;
		this.done = true;
		this.#failed = true;
		this.#error = error;
		this.rejectFinalResult(error);
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift();
			if (waiter) waiter.reject(error);
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				if (this.#queueHead < this.#queue.length) {
					return Promise.resolve({ value: this.#dequeue(), done: false });
				}
				if (this.#failed) {
					return Promise.reject(this.#error);
				}
				if (this.done) {
					return Promise.resolve({ value: undefined, done: true });
				}
				return new Promise<IteratorResult<T>>((resolve, reject) => this.waiting.push({ resolve, reject }));
			},
		};
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				} else if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}
