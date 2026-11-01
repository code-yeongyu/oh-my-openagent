import {
  SESSION_ANSWER_SELECTED_MAX,
  SESSION_QUESTION_ANSWERS_MAX,
  SESSION_UI_REQUEST_ID_MAX_CHARS,
} from "./spec-proto.ts";
import { LOCAL_CHUNK_MAX } from "./limits.ts";
import type { CommandRequest, LocalRequest, RequestType } from "./protocol.ts";
import { LOCAL_UPLOAD_PARTS_MAX } from "./upload.ts";
import {
  base64Bytes,
  bool,
  commandId,
  exactly,
  fail,
  type Fields,
  isRecord,
  localId,
  safeKey,
  text,
  uint,
} from "./validate-fields.ts";
import { COMMAND_OPS } from "./vocabulary.ts";

// session.command and its upload parts. The text is checked for shape only (a well-formed string); the engine's
// length limit is the owner's answer (message_too_long with limit_chars), never a shape refusal.
export type RequestValidators<K extends RequestType> = {
  readonly [P in K]: (v: Fields, id: string) => Extract<LocalRequest, { readonly type: P }>;
};
type Answers = Extract<CommandRequest, { readonly op: "question" }>["answers"];

export const requestFields = (
  v: Fields,
  names: readonly string[],
  optional: readonly string[] = [],
): Fields => exactly(v, ["id", "type", ...names], optional, "request");

const commandText = (v: unknown, what: string): string =>
  typeof v === "string" && v.isWellFormed() ? v : fail(what);

const answersOf = (v: unknown): Answers => {
  if (!isRecord(v) || Object.keys(v).length > SESSION_QUESTION_ANSWERS_MAX) return fail("answers");
  const out: Record<string, { readonly selected: readonly string[]; readonly text?: string }> = {};
  for (const [key, answer] of Object.entries(v)) {
    const id = safeKey(text(key, SESSION_UI_REQUEST_ID_MAX_CHARS, "answer key"), "answer key");
    const m = exactly(answer, ["selected"], ["text"], "answer");
    const selected = m["selected"];
    if (!Array.isArray(selected) || selected.length > SESSION_ANSWER_SELECTED_MAX)
      return fail("answer selected");
    const extra = m["text"] === undefined ? {} : { text: commandText(m["text"], "answer text") };
    out[id] = { selected: selected.map((s) => commandText(s, "answer selected")), ...extra };
  }
  return out;
};

const commandOf = (v: unknown): CommandRequest => {
  const m = exactly(
    v,
    ["op"],
    ["text", "ui_request_id", "confirmed", "answers", "comment"],
    "command",
  );
  const op = COMMAND_OPS.find((o) => o === m["op"]) ?? fail("command op");
  const uiRequest = (): string =>
    text(m["ui_request_id"], SESSION_UI_REQUEST_ID_MAX_CHARS, "ui_request_id");
  switch (op) {
    case "prompt":
    case "steer":
      exactly(m, ["op", "text"], [], "command");
      return { op, text: commandText(m["text"], "command text") };
    case "abort":
      exactly(m, ["op"], [], "command");
      return { op };
    case "permission":
      exactly(m, ["op", "ui_request_id", "confirmed"], [], "command");
      return { op, ui_request_id: uiRequest(), confirmed: bool(m["confirmed"], "confirmed") };
    case "question": {
      exactly(m, ["op", "ui_request_id", "answers"], ["comment"], "command");
      const comment =
        m["comment"] === undefined ? {} : { comment: commandText(m["comment"], "comment") };
      return { op, ui_request_id: uiRequest(), answers: answersOf(m["answers"]), ...comment };
    }
  }
};

const commandIdField = (v: unknown): { readonly command_id?: string } =>
  v === undefined ? {} : { command_id: commandId(v) };

export const COMMAND_REQUEST_VALIDATORS: RequestValidators<
  "session.command" | "session.command_part"
> = {
  "session.command": (v, id) => {
    if (Object.hasOwn(v, "upload_id")) {
      const m = requestFields(v, ["attach", "upload_id", "op"], ["command_id"]);
      const op = m["op"] === "prompt" || m["op"] === "steer" ? m["op"] : fail("upload op");
      const upload_id = localId(m["upload_id"], "upload_id");
      return {
        id,
        type: "session.command",
        attach: localId(m["attach"], "attach"),
        ...commandIdField(m["command_id"]),
        upload_id,
        op,
      };
    }
    const m = requestFields(v, ["attach", "command"], ["command_id"]);
    const command = commandOf(m["command"]);
    return {
      id,
      type: "session.command",
      attach: localId(m["attach"], "attach"),
      ...commandIdField(m["command_id"]),
      command,
    };
  },
  "session.command_part": (v, id) => {
    const m = requestFields(v, ["attach", "upload_id", "index", "count", "b"]);
    const count = uint(m["count"], 1, LOCAL_UPLOAD_PARTS_MAX, "count");
    base64Bytes(m["b"], LOCAL_CHUNK_MAX, "b");
    return {
      id,
      type: "session.command_part",
      attach: localId(m["attach"], "attach"),
      upload_id: localId(m["upload_id"], "upload_id"),
      index: uint(m["index"], 0, count - 1, "index"),
      count,
      b: typeof m["b"] === "string" ? m["b"] : fail("b"),
    };
  },
};
