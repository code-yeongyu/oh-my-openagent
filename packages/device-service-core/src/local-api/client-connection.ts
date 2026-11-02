import { LocalApiError } from "./errors.ts";
import { encodeLine, LineDecoder, parseLine } from "./framing.ts";
import { lineBytes, LOCAL_INLINE_MAX } from "./limits.ts";
import type { LocalEvent, LocalRequest, RequestType, ResponseData } from "./protocol.ts";
import type { Transport } from "./transport.ts";
import { validateEvent, validateResponse } from "./validate.ts";

type ParamsOf<R> = R extends unknown ? Omit<R, "id" | "type"> : never;
export type RequestParams<T extends RequestType> = ParamsOf<
  Extract<LocalRequest, { readonly type: T }>
>;

type Pending = {
  readonly settle: (message: unknown) => void;
  readonly fail: (error: LocalApiError) => void;
};

// Arms `expire` to run after `ms` and returns its cancel; tests inject one to fire an expiry without waiting.
export type DeadlineTimer = (expire: () => void, ms: number) => () => void;
export type RequestDeadline = { readonly timer: DeadlineTimer; readonly ms: number };
// A request the owner has not answered in time: settled as request_timeout, its id kept so the late answer is dropped.
// One key per expired request until its answer arrives or the connection closes; 30 s of silence makes each one.
const EXPIRED: Pending = { settle: () => {}, fail: () => {} };

const typeOf = (message: unknown): unknown =>
  typeof message === "object" && message !== null ? Reflect.get(message, "type") : undefined;

// One connection from its hello on: the first message is the handshake answer; afterwards requests are correlated
// by id and events are validated and handed on. A message the contract does not allow is a protocol violation: it
// fails every pending request and closes the connection.
export class ClientConnection {
  readonly #transport: Transport;
  readonly #onEvent: (event: LocalEvent) => void;
  readonly #pending = new Map<string, Pending>();
  readonly closed: Promise<void>;
  readonly #first: Promise<unknown>;
  #resolveFirst: ((message: unknown) => void) | undefined;
  #rejectFirst: ((error: LocalApiError) => void) | undefined;
  #nextId = 1;
  #ended = false;
  #oversized = 0;

  readonly #deadline: RequestDeadline;

  constructor(
    transport: Transport,
    onEvent: (event: LocalEvent) => void,
    deadline: RequestDeadline,
  ) {
    this.#transport = transport;
    this.#onEvent = onEvent;
    this.#deadline = deadline;
    this.#first = new Promise<unknown>((resolve, reject) => {
      this.#resolveFirst = resolve;
      this.#rejectFirst = reject;
    });
    const decoder = new LineDecoder(
      (line) => this.#onLine(line),
      () => {
        this.#oversized += 1;
      },
    );
    transport.onData((bytes) => decoder.push(bytes));
    this.closed = new Promise<void>((resolve) => {
      transport.onClose(() => {
        this.#ended = true;
        this.#failAll(new LocalApiError("closed", "the connection closed"));
        resolve();
      });
    });
  }

  send(message: unknown): void {
    this.#transport.write(encodeLine(message));
  }

  firstMessage(): Promise<unknown> {
    return this.#first;
  }

  oversizedLines(): number {
    return this.#oversized;
  }

  get endpoint(): string {
    return this.#transport.endpoint;
  }

  close(): void {
    this.#transport.close();
  }

  destroy(): void {
    this.#transport.destroy();
  }

  // `onAnswer` runs synchronously on the answer, before the next line is read, so a caller can start tracking the
  // events that follow the response on the same read.
  request<T extends RequestType>(
    type: T,
    params: RequestParams<T>,
    onAnswer?: (data: ResponseData[T]) => void,
  ): Promise<ResponseData[T]> {
    if (this.#ended) return Promise.reject(new LocalApiError("closed", "the connection is closed"));
    const id = String(this.#nextId);
    this.#nextId += 1;
    const message = { id, type, ...params };
    if (lineBytes(message) > LOCAL_INLINE_MAX)
      return Promise.reject(
        new LocalApiError("protocol_violation", "a request line over LOCAL_INLINE_MAX"),
      );
    return new Promise<ResponseData[T]>((resolve, reject) => {
      const cancel = this.#deadline.timer(() => {
        if (this.#pending.get(id) === undefined) return;
        this.#pending.set(id, EXPIRED);
        reject(new LocalApiError("request_timeout", `the owner did not answer ${type} in time`));
      }, this.#deadline.ms);
      this.#pending.set(id, {
        settle: (raw) => {
          cancel();
          let response: ReturnType<typeof validateResponse<T>>;
          try {
            response = validateResponse(raw, type);
          } catch (error) {
            // This request is already off the pending map: settle it here, then let the violation close the rest.
            if (error instanceof LocalApiError) reject(error);
            throw error;
          }
          if (!response.ok) {
            const { code, reason, action, limit_chars } = response.error;
            reject(
              new LocalApiError(
                code,
                reason,
                limit_chars === undefined ? { action } : { action, limit_chars },
              ),
            );
            return;
          }
          onAnswer?.(response.data);
          resolve(response.data);
        },
        fail: (error) => {
          cancel();
          reject(error);
        },
      });
      this.send(message);
    });
  }

  #onLine(line: Uint8Array): void {
    try {
      const message = parseLine(line);
      if (this.#resolveFirst !== undefined) {
        const resolve = this.#resolveFirst;
        this.#resolveFirst = undefined;
        this.#rejectFirst = undefined;
        resolve(message);
        return;
      }
      const type = typeOf(message);
      if (type === "response") return this.#settle(message);
      if (type === "event") return this.#onEvent(validateEvent(message));
      this.#violation("a message that is neither a response nor an event");
    } catch (error) {
      if (!(error instanceof LocalApiError)) throw error;
      this.#violation(error.reason);
    }
  }

  #settle(message: unknown): void {
    const id =
      typeof message === "object" && message !== null ? Reflect.get(message, "id") : undefined;
    const pending = typeof id === "string" ? this.#pending.get(id) : undefined;
    if (typeof id !== "string" || pending === undefined)
      return this.#violation("a response to no pending request");
    this.#pending.delete(id);
    pending.settle(message);
  }

  #violation(detail: string): void {
    this.#failAll(new LocalApiError("protocol_violation", detail));
    this.#transport.destroy();
  }

  #failAll(error: LocalApiError): void {
    this.#rejectFirst?.(error);
    this.#resolveFirst = undefined;
    this.#rejectFirst = undefined;
    for (const pending of this.#pending.values()) pending.fail(error);
    this.#pending.clear();
  }
}
