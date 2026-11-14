// Vendored from sisyphuslabs/omo-relay-daemon@08905c110bb10ab2ba725ff8b8c642a64fbd1652 packages/local-api/src/errors.ts
import type { IncompleteDevice, PathRefusal, SessionCandidate } from "./protocol.ts";
import type { SignInReason } from "./protocol-status.ts";
import type { ClientErrorCode, ErrorCode } from "./vocabulary.ts";

// Every failure the local API reports: an owner's error response (code, reason, action) or one the client raises
// itself (a refused handshake, an unproven owner, an insecure state dir, a protocol violation).
export class LocalApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly reason: string;
  readonly action: string | null;
  readonly limit_chars?: number;
  readonly path_refusal?: PathRefusal;
  // On a session.command that timed out: the command_id it was sent under, whose outcome may still arrive.
  readonly command_id?: string;
  // #393 part B: an alias's session_ambiguous candidates, or the devices that kept its session_not_found incomplete.
  readonly candidates?: readonly SessionCandidate[];
  readonly incomplete?: readonly IncompleteDevice[];
  // #1031: on a device.adopt sign_in_required that asked for it, why sign-in is needed.
  readonly sign_in_reason?: SignInReason;

  constructor(
    code: ErrorCode | ClientErrorCode,
    reason: string,
    extra: {
      readonly action?: string | null;
      readonly limit_chars?: number;
      readonly path_refusal?: PathRefusal;
      readonly command_id?: string;
      readonly candidates?: readonly SessionCandidate[];
      readonly incomplete?: readonly IncompleteDevice[];
      readonly sign_in_reason?: SignInReason;
    } = {},
  ) {
    super(`${code}: ${reason}`);
    this.name = "LocalApiError";
    this.code = code;
    this.reason = reason;
    this.action = extra.action ?? null;
    if (extra.limit_chars !== undefined) this.limit_chars = extra.limit_chars;
    if (extra.path_refusal !== undefined) this.path_refusal = extra.path_refusal;
    if (extra.command_id !== undefined) this.command_id = extra.command_id;
    if (extra.candidates !== undefined) this.candidates = extra.candidates;
    if (extra.incomplete !== undefined) this.incomplete = extra.incomplete;
    if (extra.sign_in_reason !== undefined) this.sign_in_reason = extra.sign_in_reason;
  }
}

export const protocolViolation = (detail: string): never => {
  throw new LocalApiError("protocol_violation", detail);
};
