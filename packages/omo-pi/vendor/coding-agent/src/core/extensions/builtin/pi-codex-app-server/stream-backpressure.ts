import type { AppServerJsonRpcError } from "./error-mapper.ts";
import type { NotificationProjection } from "./notification-projector.ts";

export type StreamBackpressureEvent = Exclude<NotificationProjection, { readonly kind: "skipped" }>;

export interface LagStreamEvent {
	readonly kind: "lag";
	readonly method: "lag";
	readonly connectionId: string;
	readonly sequence: number;
	readonly streamClass: "control";
	readonly droppedProgressEvents: number;
	readonly nextLosslessSequence: number;
}

export type StreamBackpressureOutput = StreamBackpressureEvent | LagStreamEvent;

export interface StreamBackpressureOptions {
	readonly connectionId: string;
	readonly bestEffortQueueLimit: number;
}

export interface StreamBackpressureStats {
	readonly droppedProgressEvents: number;
	readonly emittedLagMarkers: number;
	readonly queuedEvents: number;
}

export interface AppServerOverloadOptions {
	readonly retryAfterMs?: number;
}

export interface StreamBackpressureController {
	enqueue(event: StreamBackpressureEvent): void;
	drainAll(): readonly StreamBackpressureOutput[];
	flushTerminal(): readonly StreamBackpressureOutput[];
	stats(): StreamBackpressureStats;
}

export function createStreamBackpressureController(options: StreamBackpressureOptions): StreamBackpressureController {
	return new DefaultStreamBackpressureController(options);
}

export function createAppServerOverloadError(options: AppServerOverloadOptions = {}): AppServerJsonRpcError {
	return {
		code: -32001,
		message: "app-server overloaded",
		data: {
			retryable: true,
			...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
		},
	};
}

class DefaultStreamBackpressureController implements StreamBackpressureController {
	private readonly connectionId: string;
	private readonly bestEffortQueueLimit: number;
	private readonly queue: StreamBackpressureOutput[] = [];
	private droppedProgressEvents = 0;
	private emittedLagMarkers = 0;
	private pendingDroppedProgressEvents = 0;
	private pendingLagSequence: number | undefined;

	constructor(options: StreamBackpressureOptions) {
		this.connectionId = options.connectionId;
		this.bestEffortQueueLimit = Math.max(0, options.bestEffortQueueLimit);
	}

	enqueue(event: StreamBackpressureEvent): void {
		if (readStreamClass(event) === "best-effort") {
			this.enqueueBestEffort(event);
			return;
		}

		this.enqueueLossless(event);
	}

	drainAll(): readonly StreamBackpressureOutput[] {
		return this.drainQueuedEvents();
	}

	flushTerminal(): readonly StreamBackpressureOutput[] {
		return this.drainQueuedEvents();
	}

	stats(): StreamBackpressureStats {
		return {
			droppedProgressEvents: this.droppedProgressEvents,
			emittedLagMarkers: this.emittedLagMarkers,
			queuedEvents: this.queue.length,
		};
	}

	private enqueueBestEffort(event: StreamBackpressureEvent): void {
		if (this.countQueuedBestEffortEvents() >= this.bestEffortQueueLimit) {
			this.droppedProgressEvents += 1;
			this.pendingDroppedProgressEvents += 1;
			this.pendingLagSequence = readSequence(event);
			return;
		}
		this.queue.push(event);
	}

	private enqueueLossless(event: StreamBackpressureEvent): void {
		if (this.pendingDroppedProgressEvents > 0) {
			const nextLosslessSequence = readSequence(event);
			this.queue.push(
				this.createLagEvent(this.pendingLagSequence ?? nextLosslessSequence - 1, nextLosslessSequence),
			);
			this.pendingDroppedProgressEvents = 0;
			this.pendingLagSequence = undefined;
			this.emittedLagMarkers += 1;
		}
		this.queue.push(event);
	}

	private countQueuedBestEffortEvents(): number {
		return this.queue.filter((event) => readStreamClass(event) === "best-effort").length;
	}

	private createLagEvent(sequence: number, nextLosslessSequence: number): LagStreamEvent {
		return {
			kind: "lag",
			method: "lag",
			connectionId: this.connectionId,
			sequence,
			streamClass: "control",
			droppedProgressEvents: this.pendingDroppedProgressEvents,
			nextLosslessSequence,
		};
	}

	private drainQueuedEvents(): readonly StreamBackpressureOutput[] {
		const drained = [...this.queue];
		this.queue.length = 0;
		return drained;
	}
}

function readStreamClass(
	event: StreamBackpressureOutput,
): "lossless" | "best-effort" | "snapshot-authoritative" | "control" {
	if (event.kind === "lag") return event.streamClass;
	if (event.kind === "semantic") return event.streamClass;
	return event.envelope.streamClass;
}

function readSequence(event: StreamBackpressureEvent): number {
	if (event.kind === "semantic") return event.sequence;
	return event.envelope.sequence;
}
