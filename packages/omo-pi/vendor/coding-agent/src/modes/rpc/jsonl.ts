import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Serialize a single strict JSONL record.
 *
 * Framing is LF-only. Payload strings may contain other Unicode separators such as
 * U+2028 and U+2029. Clients must split records on `\n` only.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Attach an LF-only JSONL reader to a stream.
 *
 * This intentionally does not use Node readline. Readline splits on additional
 * Unicode separators that are valid inside JSON strings and therefore does not
 * implement strict JSONL framing.
 */
export function attachJsonlLineReader(stream: Readable, onLine: (line: string) => void): () => void {
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	const onData = (chunk: string | Buffer) => {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

		let lineStart = 0;
		let newlineIndex = buffer.indexOf("\n", lineStart);
		while (newlineIndex !== -1) {
			const lineEnd =
				newlineIndex > lineStart && buffer.charCodeAt(newlineIndex - 1) === 0x0d ? newlineIndex - 1 : newlineIndex;
			onLine(buffer.slice(lineStart, lineEnd));
			lineStart = newlineIndex + 1;
			newlineIndex = buffer.indexOf("\n", lineStart);
		}
		buffer = lineStart === 0 ? buffer : buffer.slice(lineStart);
	};

	const onEnd = () => {
		buffer += decoder.end();
		if (buffer.length > 0) {
			onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
			buffer = "";
		}
	};

	stream.on("data", onData);
	stream.on("end", onEnd);

	return () => {
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}
