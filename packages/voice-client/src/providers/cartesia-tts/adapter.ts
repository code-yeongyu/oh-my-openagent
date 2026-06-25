import Cartesia from "@cartesia/cartesia-js";
import type { TtsEvent, TtsStub } from "../../harness/types";
import { detectClauseBoundary } from "./clause-detector";
import type { CartesiaTtsConfig, ClauseBoundary } from "./types";

interface SendPayload {
  modelId: string;
  voice: { mode: "id"; id: string };
  transcript: string;
  contextId: string;
  language: "it" | "en";
}

interface SocketParams {
  container: "raw" | "mp3" | "wav";
  encoding: "pcm_f32le" | "pcm_s16le";
  sampleRate: number;
}

interface CartesiaWs {
  send(input: SendPayload): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  continue(input: SendPayload): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  cancel(input: { contextId: string }): Promise<void> | void;
  disconnect?(): void;
}

interface CartesiaLikeClient {
  tts: {
    websocket(input: SocketParams): Promise<CartesiaWs> | CartesiaWs;
  };
}

export type CartesiaTtsClientFactory = (config: CartesiaTtsConfig) => CartesiaLikeClient;

interface SynthesizeOptions {
  signal?: AbortSignal;
  boundary?: ClauseBoundary;
}

const defaults = {
  model: "sonic-3",
  language: "it",
  container: "raw",
  encoding: "pcm_f32le",
  sampleRate: 44100,
} as const;

function createDefaultClient(config: CartesiaTtsConfig): CartesiaLikeClient {
  const client = new Cartesia({ apiKey: config.apiKey });
  return {
    tts: {
      websocket: async (params) => {
        const ws = await client.tts.websocket();
        return {
          send: (payload) =>
            ws.generate({
              model_id: payload.modelId,
              voice: payload.voice,
              transcript: payload.transcript,
              context_id: payload.contextId,
              language: payload.language,
              output_format: {
                container: params.container,
                encoding: params.encoding,
                sample_rate: params.sampleRate,
              },
            }),
          continue: (payload) =>
            ws.generate({
              model_id: payload.modelId,
              voice: payload.voice,
              transcript: payload.transcript,
              context_id: payload.contextId,
              language: payload.language,
              output_format: {
                container: params.container,
                encoding: params.encoding,
                sample_rate: params.sampleRate,
              },
            }),
          cancel: ({ contextId }) => ws.cancelContext(contextId),
          disconnect: () => ws.close({ code: 1000, reason: "done" }),
        };
      },
    },
  };
}

async function* singleText(text: string): AsyncIterable<string> {
  yield text;
}

function createContextId(): string {
  return `cartesia-${crypto.randomUUID()}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bytesFromMessage(message: unknown): Uint8Array | undefined {
  if (message instanceof Uint8Array) {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }
  if (typeof message !== "object" || message === null) {
    return undefined;
  }
  const record = message as Record<string, unknown>;
  const value = record.chunk ?? record.data ?? record.audio;
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}

function clauseEnd(text: string, boundary: number): number {
  const char = text[boundary];
  return char === "," || char === ";" ? boundary + 1 : boundary;
}

export class CartesiaTtsAdapter implements TtsStub {
  private contextId = createContextId();

  constructor(
    private readonly config: CartesiaTtsConfig,
    private readonly clientFactory: CartesiaTtsClientFactory = createDefaultClient,
  ) {}

  async *synthesize(text: string, options: SynthesizeOptions = {}): AsyncIterable<TtsEvent> {
    yield* this.streamSynthesize(singleText(text), options);
  }

  async *streamSynthesize(textStream: AsyncIterable<string>, options: SynthesizeOptions = {}): AsyncIterable<TtsEvent> {
    const ws = await this.openSocket();
    let buffer = "";
    let hasSent = false;

    try {
      for await (const chunk of textStream) {
        buffer += chunk;
        while (true) {
          const boundary = detectClauseBoundary(buffer, options.boundary ?? "sentence-end");
          if (boundary === -1) {
            break;
          }
          const end = clauseEnd(buffer, boundary);
          const clause = buffer.slice(0, end);
          buffer = buffer.slice(end).trimStart();
          hasSent = yield* this.emitClause(ws, clause, hasSent, options.signal);
        }
      }

      if (buffer.length > 0) {
        hasSent = yield* this.emitClause(ws, buffer, hasSent, options.signal);
      }
    } finally {
      ws.disconnect?.();
    }
  }

  resetContext(): void {
    this.contextId = createContextId();
  }

  private async openSocket(): Promise<CartesiaWs> {
    const params = {
      container: this.config.container ?? defaults.container,
      encoding: this.config.encoding ?? defaults.encoding,
      sampleRate: this.config.sampleRate ?? defaults.sampleRate,
    };
    try {
      return await this.clientFactory(this.config).tts.websocket(params);
    } catch (error) {
      throw new Error(`Cartesia TTS websocket connection failed: ${errorMessage(error)}`);
    }
  }

  private payload(transcript: string): SendPayload {
    return {
      modelId: this.config.model ?? defaults.model,
      voice: { mode: "id", id: this.config.voice },
      transcript,
      contextId: this.contextId,
      language: this.config.language ?? defaults.language,
    };
  }

  private async *emitClause(
    ws: CartesiaWs,
    text: string,
    hasSent: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<TtsEvent, boolean> {
    if (signal?.aborted) {
      await ws.cancel({ contextId: this.contextId });
      return hasSent;
    }

    const startedAt = performance.now();
    const stream = await (hasSent ? ws.continue(this.payload(text)) : ws.send(this.payload(text)));
    let first = true;
    const iterator = stream[Symbol.asyncIterator]();

    while (true) {
      const next = await this.nextOrAbort(iterator, ws, signal);
      if (next.done) {
        return true;
      }

      const bytes = bytesFromMessage(next.value);
      if (bytes === undefined) {
        continue;
      }

      const t_ms = performance.now() - startedAt;
      if (first) {
        first = false;
        yield { kind: "first_byte", t_ms };
        if (signal?.aborted) {
          return true;
        }
      }
      yield { kind: "audio_chunk", t_ms, bytes };
    }
  }

  private async nextOrAbort(
    iterator: AsyncIterator<unknown>,
    ws: CartesiaWs,
    signal?: AbortSignal,
  ): Promise<IteratorResult<unknown>> {
    if (signal === undefined) {
      return iterator.next();
    }
    if (signal.aborted) {
      await ws.cancel({ contextId: this.contextId });
      return { done: true, value: undefined };
    }
    return Promise.race([iterator.next(), this.abortResult(ws, signal)]);
  }

  private abortResult(ws: CartesiaWs, signal: AbortSignal): Promise<IteratorResult<unknown>> {
    return new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          void Promise.resolve(ws.cancel({ contextId: this.contextId })).then(() => {
            resolve({ done: true, value: undefined });
          });
        },
        { once: true },
      );
    });
  }
}
