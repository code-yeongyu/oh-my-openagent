import { DeepgramClient } from "@deepgram/sdk";
import type { AudioSample, SttEvent, SttStub } from "../../harness/types";
import type { DeepgramSttConfig } from "./types";

type DeepgramConnectParams = {
  model: string;
  language: string;
  endpointing: number;
  interim_results: "true";
  punctuate: "true";
  sample_rate?: number;
  encoding?: string;
};

type DeepgramAlternative = { transcript?: string };
type DeepgramResultMessage = {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: DeepgramAlternative[] };
};

type DeepgramConnection = {
  on(event: "message", handler: (data: DeepgramResultMessage) => void): void;
  on(event: "close", handler: () => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  connect(): void;
  waitForOpen(): Promise<unknown>;
  sendMedia(chunk: ArrayBuffer): void;
  sendFinalize(message: { type: "Finalize" }): void;
  close(): void;
};

type DeepgramClientLike = {
  listen: { v1: { connect(params: DeepgramConnectParams): Promise<DeepgramConnection> } };
};

export type DeepgramClientFactory = (apiKey: string) => DeepgramClientLike;

const defaultFactory: DeepgramClientFactory = (apiKey) => {
  const client = new DeepgramClient({ apiKey });
  return {
    listen: {
      v1: {
        connect: async (params) => {
          const socket = await client.listen.v1.connect({ ...params, Authorization: `Token ${apiKey}` });
          return {
            on: (event, handler) => socket.on(event, handler),
            connect: () => socket.connect(),
            waitForOpen: async () => {
              await socket.waitForOpen();
            },
            sendMedia: (chunk) => socket.sendMedia(chunk),
            sendFinalize: (message) => socket.sendFinalize(message),
            close: () => socket.close(),
          };
        },
      },
    },
  };
};

export interface StreamLiveOptions {
  signal?: AbortSignal;
}

export class DeepgramSttAdapter implements SttStub {
  constructor(
    private readonly config: DeepgramSttConfig,
    private readonly clientFactory: DeepgramClientFactory = defaultFactory,
  ) {}

  async *streamLive(
    frames: AsyncIterable<ArrayBuffer>,
    options?: StreamLiveOptions,
  ): AsyncIterable<SttEvent> {
    const startedAt = performance.now();
    const events: SttEvent[] = [];
    let connection: DeepgramConnection | undefined;
    let done = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;

    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const complete = () => {
      done = true;
      notify();
    };
    const fail = (error: Error) => {
      failure = error;
      notify();
    };
    const push = (event: SttEvent) => {
      events.push(event);
      notify();
    };
    const nextEvent = async (): Promise<SttEvent | undefined> => {
      while (events.length === 0 && !done && !failure) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure) throw failure;
      return events.shift();
    };
    const throwIfAborted = () => {
      if (options?.signal?.aborted) {
        const err = new Error("AbortError");
        err.name = "AbortError";
        throw err;
      }
    };

    try {
      throwIfAborted();
      const client = this.clientFactory(this.config.apiKey);
      try {
        connection = await client.listen.v1.connect(this.connectParams());
      } catch (error) {
        throw new Error(`deepgram connect failed: ${this.errorMessage(error)}`);
      }

      connection.on("message", (message) => {
        const event = this.toSttEvent(message, startedAt);
        if (!event) return;
        push(event);
      });
      connection.on("close", complete);
      connection.on("error", fail);
      connection.connect();
      await connection.waitForOpen();

      const conn = connection;
      const pumpFrames = (async () => {
        try {
          for await (const frame of frames) {
            throwIfAborted();
            conn.sendMedia(frame);
          }
          conn.sendFinalize({ type: "Finalize" });
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      })();
      void pumpFrames;

      while (true) {
        throwIfAborted();
        const event = await nextEvent();
        if (!event) return;
        yield event;
      }
    } finally {
      connection?.close();
    }
  }

  async *transcribe(sample: AudioSample): AsyncIterable<SttEvent> {
    const startedAt = performance.now();
    const events: SttEvent[] = [];
    let connection: DeepgramConnection | undefined;
    let done = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;

    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const complete = () => {
      done = true;
      notify();
    };
    const fail = (error: Error) => {
      failure = error;
      notify();
    };
    const push = (event: SttEvent) => {
      events.push(event);
      notify();
    };
    const nextEvent = async (): Promise<SttEvent | undefined> => {
      while (events.length === 0 && !done && !failure) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      if (failure) throw failure;
      return events.shift();
    };

    try {
      const client = this.clientFactory(this.config.apiKey);
      try {
        connection = await client.listen.v1.connect(this.connectParams());
      } catch (error) {
        throw new Error(`deepgram connect failed: ${this.errorMessage(error)}`);
      }

      connection.on("message", (message) => {
        const event = this.toSttEvent(message, startedAt);
        if (!event) return;
        push(event);
        if (event.kind === "final") complete();
      });
      connection.on("close", complete);
      connection.on("error", fail);
      connection.connect();
      await connection.waitForOpen();
      connection.sendMedia(await Bun.file(sample.wavPath).arrayBuffer());
      connection.sendFinalize({ type: "Finalize" });

      while (true) {
        const event = await nextEvent();
        if (!event) return;
        yield event;
      }
    } finally {
      connection?.close();
    }
  }

  private connectParams(): DeepgramConnectParams {
    return {
      model: this.config.model ?? "nova-3",
      language: this.config.language ?? "multi",
      endpointing: this.config.endpointingMs ?? 100,
      interim_results: "true",
      punctuate: "true",
      ...(this.config.sampleRate === undefined ? {} : { sample_rate: this.config.sampleRate }),
      ...(this.config.encoding === undefined ? {} : { encoding: this.config.encoding }),
    };
  }

  private toSttEvent(message: DeepgramResultMessage, startedAt: number): SttEvent | undefined {
    if (message.type !== "Results") return undefined;
    const text = message.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return undefined;
    return {
      kind: message.is_final ? "final" : "partial",
      text,
      t_ms: Math.round(performance.now() - startedAt),
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
