// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol-command.ts
import type { CommandRpc } from "./protocol.ts";
import type { DelegatedRoute } from "./protocol-delegated.ts";
import type { AliasIncompleteReason } from "./vocabulary.ts";

// What a session.command addresses: a session through this connection's attach; a device's engine endpoint with no
// attach (#393 part A); a session by its id `<device>.<key>` or by its title (an alias), with no attach (#393 part B).
// An endpoint carries a session-less record, and a session id or alias is always delegated. omo#13037: `wake` names a
// session no listing maps, by its device and durable id, for a peer delivery only; it is always delegated too.
export type WakeTarget = { readonly device: string; readonly durable_id: string };
export type CommandTarget =
  | { readonly attach: string }
  | { readonly device: string; readonly endpoint: string }
  | { readonly session: string }
  | { readonly alias: string }
  | { readonly wake: WakeTarget };
// A part names the target its final names; a device part names the device only.
export type SessionCommandPartTarget =
  | { readonly attach: string }
  | { readonly device: string }
  | { readonly session: string }
  | { readonly alias: string }
  | { readonly wake: WakeTarget };
// session.command and its upload parts (docs/local-api.md "Commands"): one engine RPC record, inline or uploaded.
export type SessionCommand = {
  readonly id: string;
  readonly type: "session.command";
  readonly command_id?: string;
  /** omo#13037 A6: the sender understands the wake answer; copied into the record only toward a device listing it. */
  readonly accepts?: readonly "session-wake:v1"[];
} & CommandTarget &
  ({ readonly rpc: CommandRpc } | { readonly upload_id: string }) &
  DelegatedRoute;
export type SessionCommandPart = {
  readonly id: string;
  readonly type: "session.command_part";
  readonly upload_id: string;
  readonly index: number;
  readonly count: number;
  readonly b: string;
} & SessionCommandPartTarget;
// #393 part B: what a {session} or {alias} command answers beside its command_id. `session` is the only string a tool
// feeds back as a target; `key` is the bare stream key, for correlating with listing rows and session.attach.
export type SessionCommandAnswer = {
  readonly command_id: string;
  readonly device?: string;
  readonly key?: string;
  readonly session?: string;
};

// #393 part B's error body details (ErrorBody in protocol.ts): a row an alias matched, and a device whose listing
// was not complete.
export type SessionCandidate = {
  readonly device: string;
  readonly key: string;
  readonly session: string;
};
export type IncompleteDevice = { readonly device: string; readonly reason: AliasIncompleteReason };
