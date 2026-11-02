import type { ClientErrorCode, ErrorCode } from "./vocabulary.ts";

// Every failure the local API reports: an owner's error response (code, reason, action) or one the client raises
// itself (a refused handshake, an unproven owner, an insecure state dir, a protocol violation).
export class LocalApiError extends Error {
  readonly code: ErrorCode | ClientErrorCode;
  readonly reason: string;
  readonly action: string | null;
  readonly limit_chars?: number;
  // On a session.command that timed out: the command_id it was sent under, whose outcome may still arrive.
  readonly command_id?: string;

  constructor(
    code: ErrorCode | ClientErrorCode,
    reason: string,
    extra: {
      readonly action?: string | null;
      readonly limit_chars?: number;
      readonly command_id?: string;
    } = {},
  ) {
    super(`${code}: ${reason}`);
    this.name = "LocalApiError";
    this.code = code;
    this.reason = reason;
    this.action = extra.action ?? null;
    if (extra.limit_chars !== undefined) this.limit_chars = extra.limit_chars;
    if (extra.command_id !== undefined) this.command_id = extra.command_id;
  }
}

export const protocolViolation = (detail: string): never => {
  throw new LocalApiError("protocol_violation", detail);
};
