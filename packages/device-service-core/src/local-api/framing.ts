import { LocalApiError } from "./errors.ts";

// Framing: LF-delimited UTF-8 JSON, one object per line, at most LOCAL_LINE_MAX bytes per line (the LF not counted).
export const LOCAL_LINE_MAX = 1_048_576;
const LF = 0x0a;
const encoder = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true });

export const encodeLine = (value: unknown): Uint8Array => {
  const body = encoder.encode(JSON.stringify(value));
  if (body.length > LOCAL_LINE_MAX)
    throw new LocalApiError(
      "protocol_violation",
      `a ${body.length}-byte line exceeds LOCAL_LINE_MAX`,
    );
  const line = new Uint8Array(body.length + 1);
  line.set(body);
  line[body.length] = LF;
  return line;
};

export const parseLine = (line: Uint8Array): unknown => {
  let decoded: string;
  try {
    decoded = utf8.decode(line);
  } catch (error) {
    if (error instanceof TypeError)
      throw new LocalApiError("protocol_violation", "a line is not UTF-8");
    throw error;
  }
  try {
    return JSON.parse(decoded);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new LocalApiError("protocol_violation", "a line is not JSON");
    throw error;
  }
};

// Splits a byte stream into lines. A line longer than LOCAL_LINE_MAX is reported once when it crosses the limit and
// dropped up to its LF; decoding resynchronizes on the next line.
export class LineDecoder {
  readonly #onLine: (line: Uint8Array) => void;
  readonly #onOversized: (bytesSeen: number) => void;
  #parts: Uint8Array[] = [];
  #length = 0;
  #discarding = false;

  constructor(onLine: (line: Uint8Array) => void, onOversized: (bytesSeen: number) => void) {
    this.#onLine = onLine;
    this.#onOversized = onOversized;
  }

  push(chunk: Uint8Array): void {
    let start = 0;
    while (start < chunk.length) {
      const lf = chunk.indexOf(LF, start);
      this.#take(chunk.subarray(start, lf === -1 ? chunk.length : lf));
      if (lf === -1) return;
      this.#finish();
      start = lf + 1;
    }
  }

  #take(piece: Uint8Array): void {
    if (this.#discarding || piece.length === 0) return;
    if (this.#length + piece.length > LOCAL_LINE_MAX) {
      this.#discarding = true;
      this.#onOversized(this.#length + piece.length);
      this.#parts = [];
      this.#length = 0;
      return;
    }
    this.#parts.push(piece.slice());
    this.#length += piece.length;
  }

  #finish(): void {
    if (this.#discarding) {
      this.#discarding = false;
      return;
    }
    const line = new Uint8Array(this.#length);
    let at = 0;
    for (const part of this.#parts) {
      line.set(part, at);
      at += part.length;
    }
    this.#parts = [];
    this.#length = 0;
    this.#onLine(line);
  }
}
