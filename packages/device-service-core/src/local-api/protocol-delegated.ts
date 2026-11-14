// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol-delegated.ts
import type { EventOf, JsonObject } from "./protocol.ts";
import type { SessionCandidate } from "./protocol-command.ts";
import type { ChannelClosedReason } from "./vocabulary.ts";
import type { PresenterRequest, PresenterResponseData } from "./protocol-presenter.ts";

// The delegated command channel on the local API v1 (DS2b, decision 0018). A client opts one session.command into its
// own delegated engine connection on the host with `delegated: true`, or addresses a host engine endpoint (a
// session-less record) with `endpoint`, a key it learns from session.endpoints. Every frame that engine connection writes
// unasked, and the reply of every delegated command, arrives as session.command_event on the connection that sent the
// command. Frames keep the engine's write order, and so do replies; toward a host on decision 0018's 2026-11-06
// amendment a reply may arrive before frames the engine wrote before it (results first), so a client never reads "the
// reply came" as "every earlier frame came". A value too large for one line arrives as a blob of its UTF-8 JSON in
// session.command_blob_chunk events, ended by session.command_blob_done. session.channel_closed ends the channel toward
// that device exactly like a closed socket: the next delegated command opens a fresh one.
export type DelegatedRoute = {
  readonly delegated?: true;
  readonly endpoint?: string;
  /** 0018 amendment 2026-11-06 (5B): the client asks for the new session's located key on an open's reply. */
  readonly locate?: true;
};
/** 5B: the session an applied open made, as session.locate would answer it (only to a client that asked). */
export type CommandLocated = { readonly key: string; readonly session: string };
export type SessionEndpoints = {
  readonly id: string;
  readonly type: "session.endpoints";
  readonly device: string;
  /**
   * 0.1.11: ask for `primary` in the answer. Sent only to a service whose welcome.service_version is 0.1.11 or later;
   * an older service refuses the unknown field.
   */
  readonly primary?: true;
  /**
   * #914: ask for `environments` in the answer. Sent only to a service whose welcome.service_version is 0.1.24 or later;
   * an older service refuses the unknown field. Without it, every client but omo-ai through 5.1.66 (whose decoder refuses
   * any field but `endpoints`) still gets `environments` by default.
   */
  readonly environments?: true;
};
/**
 * #393 part B (design C6; decision 0005, amended 2026-11-04): the id of a session this client just created over an
 * engine endpoint, found by the durable engine session id in the create reply. Answered {device, key, session}.
 */
export type SessionLocate = {
  readonly id: string;
  readonly type: "session.locate";
  readonly device: string;
  readonly engine_id: string;
  /**
   * omo#13037 (A4): one probe, no wait for the device's next change, a 3 s bound; the answering side is told to skip its
   * settle wait. Sent only to a service that knows it (an older one refuses the unknown field).
   */
  readonly single?: true;
};
/** Decision 0019: `environments` only from a host that lists session-environment:v1; #914: never to omo-ai <= 5.1.66 unasked. */
export type SessionEndpointsData = {
  readonly endpoints: readonly string[];
  readonly environments?: readonly string[];
  /**
   * 0.1.11: the host's primary engine endpoint, one of `endpoints` (its first), only to a request that asked and only from
   * a host listing session-endpoint-primary:v1. Absent: the host names none, or predates it.
   */
  readonly primary?: string;
};
// Decision 0020: the presenter tunnel rides a delegated channel (protocol-presenter.ts).
export type DelegatedRequest = SessionEndpoints | SessionLocate | PresenterRequest;
export type DelegatedResponseData = {
  readonly "session.endpoints": SessionEndpointsData;
  readonly "session.locate": SessionCandidate;
} & PresenterResponseData;

export type CommandBlobRef = {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
};
export type CommandEventBody =
  | { readonly frame: JsonObject }
  | {
      readonly command_id: string;
      readonly response: JsonObject;
      readonly located?: CommandLocated;
    };
export type CommandEvent = EventOf<
  "session.command_event",
  { readonly device: string } & (CommandEventBody | { readonly blob: CommandBlobRef })
>;
export type CommandBlobChunk = EventOf<
  "session.command_blob_chunk",
  { readonly id: string; readonly off: number; readonly b: string }
>;
export type CommandBlobDone = EventOf<"session.command_blob_done", { readonly id: string }>;
export type ChannelClosed = EventOf<
  "session.channel_closed",
  { readonly device: string; readonly reason: ChannelClosedReason }
>;
export type DelegatedEvent = CommandEvent | CommandBlobChunk | CommandBlobDone | ChannelClosed;
