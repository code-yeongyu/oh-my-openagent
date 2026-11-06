import { encodeLine, LineDecoder, parseLine } from "../../../src/local-api/framing.ts";
import type { Transport } from "../../../src/local-api/transport.ts";

// One end of a local API connection at the line level: what the conformance runner, the fake owner's tests and the
// squatting fakes use to send exact lines and read every message the other end wrote, in order.
export type RawPeer = {
  readonly endpoint: string;
  readonly send: (value: unknown) => void;
  readonly sendBytes: (bytes: Uint8Array) => void;
  readonly next: (timeoutMs?: number) => Promise<unknown>;
  readonly received: readonly unknown[];
  readonly sizes: readonly number[];
  readonly oversized: () => number;
  readonly closed: Promise<void>;
  readonly isClosed: () => boolean;
  readonly close: () => void;
};

export const NEXT_TIMEOUT_MS = 10_000;

export class PeerClosed extends Error {
  constructor() {
    super("the connection closed before the next message");
    this.name = "PeerClosed";
  }
}

export const rawPeer = (transport: Transport): RawPeer => {
  const received: unknown[] = [];
  const sizes: number[] = [];
  const queue: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  let oversized = 0;
  let closed = false;
  let markClosed = (): void => {};
  const closedPromise = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  const decoder = new LineDecoder(
    (line) => {
      const message = parseLine(line);
      sizes.push(line.length + 1);
      received.push(message);
      const waiter = waiters.shift();
      if (waiter === undefined) queue.push(message);
      else waiter(message);
    },
    () => {
      oversized += 1;
    },
  );
  transport.onData((bytes) => decoder.push(bytes));
  transport.onClose(() => {
    closed = true;
    markClosed();
  });
  const next = (timeoutMs = NEXT_TIMEOUT_MS): Promise<unknown> => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    if (closed) return Promise.reject(new PeerClosed());
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(onMessage), 1);
        reject(new Error(`no message within ${timeoutMs} ms`));
      }, timeoutMs);
      const onMessage = (value: unknown): void => {
        clearTimeout(timer);
        resolve(value);
      };
      waiters.push(onMessage);
      void closedPromise.then(() => {
        if (!waiters.includes(onMessage)) return;
        waiters.splice(waiters.indexOf(onMessage), 1);
        clearTimeout(timer);
        reject(new PeerClosed());
      });
    });
  };
  return {
    endpoint: transport.endpoint,
    send: (value) => transport.write(encodeLine(value)),
    sendBytes: (bytes) => transport.write(bytes),
    next,
    received,
    sizes,
    oversized: () => oversized,
    closed: closedPromise,
    isClosed: () => closed,
    close: () => transport.close(),
  };
};
