import type { PathRefusal } from "./protocol.ts";
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
  // Set when the call failed before any session.command was written (for example the endpoint lookup an endpoint
  // command makes first): nothing was dispatched, so a caller may treat it as refused and retry safely.
  readonly not_sent?: true;

  constructor(
    code: ErrorCode | ClientErrorCode,
    reason: string,
    extra: {
      readonly action?: string | null;
      readonly limit_chars?: number;
      readonly path_refusal?: PathRefusal;
      readonly command_id?: string;
      readonly not_sent?: true;
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
    if (extra.not_sent === true) this.not_sent = true;
  }
}

export const protocolViolation = (detail: string): never => {
  throw new LocalApiError("protocol_violation", detail);
};
