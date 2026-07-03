import { serializeJsonLine } from "./jsonl.ts";

type RawWriter = (chunk: string) => void;
type FlushScheduler = (flush: () => void) => void;

export type RpcEventOutputBuffer = {
	readonly enqueueEvent: (event: object) => void;
	readonly writeImmediate: (value: object) => void;
	readonly flushEvents: () => void;
};

export function createRpcEventOutputBuffer(
	writeRaw: RawWriter,
	scheduleFlush: FlushScheduler = queueMicrotask,
): RpcEventOutputBuffer {
	let pendingEventLines: string[] = [];
	let flushScheduled = false;

	const flushEvents = (): void => {
		flushScheduled = false;
		if (pendingEventLines.length === 0) return;
		writeRaw(pendingEventLines.join(""));
		pendingEventLines = [];
	};

	return {
		enqueueEvent(event) {
			pendingEventLines.push(serializeJsonLine(event));
			if (flushScheduled) return;
			flushScheduled = true;
			scheduleFlush(flushEvents);
		},
		writeImmediate(value) {
			flushEvents();
			writeRaw(serializeJsonLine(value));
		},
		flushEvents,
	};
}
