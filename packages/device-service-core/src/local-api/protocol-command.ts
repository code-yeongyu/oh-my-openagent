import type { CommandRpc } from "./protocol.ts";
import type { DelegatedRoute } from "./protocol-delegated.ts";

// session.command and its upload parts (docs/local-api.md "Commands"): one engine RPC record, inline or uploaded.
export type SessionCommand = (
  | {
      // #393: the attach-less endpoint command names the host device and one of its engine endpoint keys.
      readonly id: string;
      readonly type: "session.command";
      readonly device: string;
      readonly endpoint: string;
      readonly command_id?: string;
      readonly rpc: CommandRpc;
    }
  | {
      readonly id: string;
      readonly type: "session.command";
      readonly attach: string;
      readonly command_id?: string;
      readonly rpc: CommandRpc;
    }
  | {
      readonly id: string;
      readonly type: "session.command";
      readonly attach: string;
      readonly command_id?: string;
      readonly upload_id: string;
    }
) &
  DelegatedRoute;
export type SessionCommandPart = {
  readonly id: string;
  readonly type: "session.command_part";
  readonly attach: string;
  readonly upload_id: string;
  readonly index: number;
  readonly count: number;
  readonly b: string;
};
