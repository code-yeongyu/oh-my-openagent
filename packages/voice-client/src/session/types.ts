export interface SessionAdapterConfig {
  serverUrl: string;
  apiKey?: string;
  sessionId?: string;
  model?: string;
  agent?: string;
  voiceIntent?: boolean;
}

export type SessionEvent =
  | { kind: "text-delta"; text: string; t_ms: number }
  | { kind: "clause-boundary"; text: string; t_ms: number }
  | { kind: "tool-call-started"; toolName: string; t_ms: number }
  | {
      kind: "tool-call-finished";
      toolName: string;
      status: "completed" | "error";
      t_ms: number;
    }
  | { kind: "session-idle"; t_ms: number }
  | { kind: "session-error"; message: string; t_ms: number }
  | { kind: "session-compacting"; t_ms: number };

export interface SessionAdapterHandle {
  sessionId: string | null;
  sendPrompt(text: string): Promise<string>;
  events(): AsyncIterable<SessionEvent>;
  close(): void;
}

export interface OpencodeMessagePart {
  type: "text";
  text: string;
}

export interface OpencodeSendMessageRequest {
  sessionID: string;
  parts: OpencodeMessagePart[];
  agent?: string;
  model?: string;
}

export type OpencodeRawEvent =
  | { type: "message.part.delta"; field: "text"; text: string }
  | {
      type: "message.part.updated";
      part: {
        type: "tool";
        name: string;
        state: { status: "running" | "completed" | "error" };
      };
    }
  | { type: "session.idle" }
  | { type: "session.error"; error?: { message: string } }
  | { type: "session.compacting" };

export interface OpencodeLikeClient {
  createSession(opts: {
    agent?: string;
    model?: string;
  }): Promise<{ sessionID: string }>;
  sendMessage(req: OpencodeSendMessageRequest): Promise<{ messageID: string }>;
  events(opts: { sessionID: string }): AsyncIterable<OpencodeRawEvent>;
  close(): void;
}
