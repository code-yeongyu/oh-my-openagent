import type { MultiplexerType } from "../../shared/terminal-multiplexer/types";

export interface InteractiveBashSessionState {
  sessionID: string;
  tmuxSessions: Set<string>;
  multiplexerType: MultiplexerType | null;
  updatedAt: number;
}

export interface SerializedInteractiveBashSessionState {
  sessionID: string;
  tmuxSessions: string[];
  multiplexerType: MultiplexerType | null;
  updatedAt: number;
}
