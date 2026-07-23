import type { Event } from "@opencode-ai/sdk";
import type { PluginContext } from "./types";

export type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void;
  clear: (sessionID: string) => void;
};

export type EventInput = { event: Event };

type InternalTextPart = {
  type: "text";
  text: string;
  synthetic?: boolean;
  metadata?: Record<string, unknown>;
};

type InternalPromptInput = {
  path: { id: string };
  body: {
    parts: InternalTextPart[];
    agent?: string;
    model?: { providerID: string; modelID: string };
    variant?: string;
  };
  query: { directory: string };
};

export type PluginEventContext = PluginContext & {
  directory: string;
  client: {
    session: {
      abort: (input: { path: { id: string }; throwOnError?: boolean }) => Promise<unknown>;
      promptAsync?: (input: InternalPromptInput) => Promise<unknown>;
      prompt: (input: InternalPromptInput) => Promise<unknown>;
      summarize: {
        (input: {
          path: { id: string };
          body: { providerID: string; modelID: string; auto?: boolean };
          query: { directory: string };
        }): Promise<unknown>;
        (input: {
          path: { id: string };
          body: { auto: boolean };
          query: { directory: string };
        }): Promise<unknown>;
      };
    };
  };
};

export type EventHookRunner = (
  hookName: string,
  handler: ((input: EventInput) => unknown | Promise<unknown>) | null | undefined,
  input: EventInput,
) => Promise<void>;
