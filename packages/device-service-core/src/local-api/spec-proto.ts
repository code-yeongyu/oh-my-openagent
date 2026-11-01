// The session-contract limits local API v1 checks against (docs/local-api.md: message and blob limits, field bounds).
export const SESSION_BLOB_MAX = 16_777_216;
export const SESSION_COMMAND_TEXT_MAX_CHARS = 1_000_000;
export const SESSION_COMMAND_TEXT_MAX_BYTES = 3_000_000;
export const SESSION_UI_REQUEST_ID_MAX_CHARS = 256;
export const SESSION_QUESTION_ANSWERS_MAX = 64;
export const SESSION_ANSWER_SELECTED_MAX = 64;
export const SESSION_DEVICE_MAX_CHARS = 64;
export const SESSION_PROJECT_MAX_CHARS = 256;
export const SESSION_ID_MAX_CHARS = 128;
export const SESSION_READ_TAIL_MAX = 200;
export const SESSION_SUMMARY_TITLE_MAX_CHARS = 256;
export const SESSION_SUMMARY_PROJECT_MAX_CHARS = 128;
export const SESSION_SUMMARY_PATH_MAX_CHARS = 1024;

export class ProtoError extends Error {
  readonly code: "payload_too_large" | "malformed";
  constructor(code: "payload_too_large" | "malformed", message: string) {
    super(message);
    this.code = code;
  }
}

export const validateCommandText = (text: unknown): string => {
  if (typeof text !== "string" || !text.isWellFormed()) throw new ProtoError("malformed", "command text");
  if (
    text.length > SESSION_COMMAND_TEXT_MAX_CHARS ||
    new TextEncoder().encode(text).length > SESSION_COMMAND_TEXT_MAX_BYTES
  )
    throw new ProtoError("payload_too_large", "session command text over the limit");
  return text;
};
