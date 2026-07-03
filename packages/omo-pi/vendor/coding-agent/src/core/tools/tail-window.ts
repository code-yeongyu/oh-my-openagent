const MAX_PENDING_TAIL_CHUNKS = 10;

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

export class TailWindow {
	private readonly maxBytes: number;
	private chunks: string[] = [];
	private bytes = 0;
	private startsAtBoundary = true;

	constructor(maxBytes: number) {
		this.maxBytes = maxBytes;
	}

	append(text: string, bytes: number, startsAtLineBoundary: boolean): void {
		if (bytes === 0) {
			return;
		}
		if (bytes >= this.maxBytes) {
			this.replaceWithTail(text, startsAtLineBoundary);
			return;
		}

		this.chunks.push(text);
		this.bytes += bytes;
		if (this.chunks.length > MAX_PENDING_TAIL_CHUNKS) {
			this.compact();
		}
		if (this.bytes > this.maxBytes * 2) {
			this.trimToMax();
		}
	}

	text(): string {
		this.trimToMax();
		return this.joined();
	}

	get startsAtLineBoundary(): boolean {
		return this.startsAtBoundary;
	}

	private replaceWithTail(text: string, startsAtLineBoundary: boolean): void {
		const buffer = Buffer.from(text, "utf-8");
		let start = Math.max(0, buffer.length - this.maxBytes);
		while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
			start++;
		}

		this.startsAtBoundary = start === 0 ? startsAtLineBoundary : buffer[start - 1] === 0x0a;
		const tail = buffer.subarray(start).toString("utf-8");
		this.chunks = tail.length > 0 ? [tail] : [];
		this.bytes = byteLength(tail);
	}

	private joined(): string {
		if (this.chunks.length === 0) {
			return "";
		}
		if (this.chunks.length > 1) {
			this.compact();
		}
		return this.chunks[0] ?? "";
	}

	private compact(): void {
		const joined = this.chunks.join("");
		this.chunks = joined.length > 0 ? [joined] : [];
	}

	private trimToMax(): void {
		if (this.bytes <= this.maxBytes) {
			return;
		}

		const buffer = Buffer.from(this.joined(), "utf-8");
		let start = Math.max(0, buffer.length - this.maxBytes);
		while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
			start++;
		}

		this.startsAtBoundary = start === 0 ? this.startsAtBoundary : buffer[start - 1] === 0x0a;
		const tail = buffer.subarray(start).toString("utf-8");
		this.chunks = tail.length > 0 ? [tail] : [];
		this.bytes = byteLength(tail);
	}
}
