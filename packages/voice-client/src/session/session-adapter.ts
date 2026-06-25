import { prependVoiceIntent } from "../constants/voice-intent.ts";
import { detectClauseBoundary } from "../providers/cartesia-tts/clause-detector.ts";
import type {
  OpencodeLikeClient,
  SessionAdapterConfig,
  SessionAdapterHandle,
  SessionEvent,
} from "./types.ts";

export type OpencodeClientFactory = (
  config: SessionAdapterConfig,
) => OpencodeLikeClient;

export class OpencodeSessionAdapter implements SessionAdapterHandle {
  sessionId: string | null = null;
  private client: OpencodeLikeClient;
  private config: SessionAdapterConfig;
  private closed = false;
  private startedAt = 0;

  constructor(config: SessionAdapterConfig, factory?: OpencodeClientFactory) {
    this.config = config;
    if (!factory) {
      throw new Error(
        "OpencodeSessionAdapter: a client factory is required; the default SDK-backed factory is wired in a follow-up",
      );
    }
    this.client = factory(config);
  }

  async open(): Promise<void> {
    this.startedAt = performance.now();
    try {
      const session = await this.client.createSession({
        agent: this.config.agent,
        model: this.config.model,
      });
      this.sessionId = session.sessionID;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`opencode connect failed: ${msg}`);
    }
  }

  async sendPrompt(text: string): Promise<string> {
    if (!this.sessionId) {
      throw new Error("sendPrompt: session not open");
    }
    const enriched =
      this.config.voiceIntent === false ? text : prependVoiceIntent(text);
    const result = await this.client.sendMessage({
      sessionID: this.sessionId,
      parts: [{ type: "text", text: enriched }],
      agent: this.config.agent,
      model: this.config.model,
    });
    return result.messageID;
  }

  async *events(): AsyncIterable<SessionEvent> {
    if (!this.sessionId) {
      throw new Error("events: session not open");
    }
    let buffer = "";
    for await (const ev of this.client.events({ sessionID: this.sessionId })) {
      if (this.closed) return;
      const t_ms = performance.now() - this.startedAt;
      if (ev.type === "message.part.delta" && ev.field === "text") {
        buffer += ev.text;
        yield { kind: "text-delta", text: ev.text, t_ms };
        const boundary = detectClauseBoundary(buffer, "sentence-end");
        if (boundary > 0) {
          yield { kind: "clause-boundary", text: buffer.slice(0, boundary), t_ms };
          buffer = buffer.slice(boundary);
        }
      } else if (
        ev.type === "message.part.updated" &&
        ev.part.type === "tool"
      ) {
        const status = ev.part.state.status;
        if (status === "running") {
          yield { kind: "tool-call-started", toolName: ev.part.name, t_ms };
        } else {
          yield {
            kind: "tool-call-finished",
            toolName: ev.part.name,
            status: status === "error" ? "error" : "completed",
            t_ms,
          };
        }
      } else if (ev.type === "session.idle") {
        yield { kind: "session-idle", t_ms };
        return;
      } else if (ev.type === "session.error") {
        yield {
          kind: "session-error",
          message: ev.error?.message ?? "unknown error",
          t_ms,
        };
        return;
      } else if (ev.type === "session.compacting") {
        yield { kind: "session-compacting", t_ms };
      }
    }
  }

  close(): void {
    this.closed = true;
    this.client.close();
  }
}
