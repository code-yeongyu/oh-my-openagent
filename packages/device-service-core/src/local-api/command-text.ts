// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/command-text.ts
import { ProtoError } from "./spec-proto.ts";

// The five-op session.command text limits and text check, kept local after relay-spec decision 0011 replaced that
// command body with one engine RPC record. Values and behavior are the pre-0011 spec's; the one-RPC rewrite is #105.
export const COMMAND_TEXT_MAX_CHARS = 1_000_000;
export const COMMAND_TEXT_MAX_BYTES = 3_000_000;
export const UI_REQUEST_ID_MAX_CHARS = 256;

export const validateCommandText = (text: unknown): string => {
  if (typeof text !== "string" || !text.isWellFormed())
    throw new ProtoError("bad_request", "session payload command text");
  if (
    text.length > COMMAND_TEXT_MAX_CHARS ||
    new TextEncoder().encode(text).length > COMMAND_TEXT_MAX_BYTES
  )
    throw new ProtoError("payload_too_large", "session command text over the limit");
  return text;
};
