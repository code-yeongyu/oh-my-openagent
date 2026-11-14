// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/protocol-status.ts
import type { DeviceRef, Policy } from "./protocol.ts";
import type { StatusUpdate } from "./protocol-control.ts";
import type { StatusState } from "./vocabulary.ts";

// #1031 (0.1.31): why the service asks for sign-in, beside the unchanged code sign_in_required: no adopted device, the
// device revoked, or the account service asking to sign in again. It is sent only to a request that asks
// (`sign_in_reason: true`), because shipped validators refuse an unknown key in status.detail and in an error body.
export const SIGN_IN_REASONS = ["not_adopted", "device_revoked", "reauth_required"] as const;
export type SignInReason = (typeof SIGN_IN_REASONS)[number];
export type StatusDetail = {
  readonly code: string;
  readonly action: string | null;
  readonly sign_in_reason?: SignInReason;
};

export type Status = {
  readonly state: StatusState;
  readonly since_ms: number;
  readonly detail?: StatusDetail;
  readonly device: DeviceRef | null;
  readonly origin_configured: boolean;
  readonly enabled: boolean;
  readonly policy?: Policy;
  readonly update?: StatusUpdate;
  /** 0.1.30: the service's executable path, only in a status.get answer to a request that asked (`exe: true`). */
  readonly exe?: string;
};

// 0.1.30: exe: true asks for exe in the answer; send it only to a 0.1.30+ service (older ones refuse the field).
// 0.1.31: sign_in_reason: true asks for detail.sign_in_reason (#1031); likewise only to a 0.1.31+ service.
export type StatusGet = {
  readonly id: string;
  readonly type: "status.get";
  readonly exe?: true;
  readonly sign_in_reason?: true;
};
