import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { log } from "./logger";

/**
 * sessionID characters allowed in on-disk filenames. All session IDs flow from
 * `resolveSessionEventID` (harness-derived `ses_<alnum>` / randomUUID), so this
 * pattern is always satisfied in practice; the check below is always-on
 * defense-in-depth against directory traversal. A non-conforming ID never
 * reaches the filesystem — operations degrade fail-safe (load falls back,
 * save/clear become no-ops) rather than throwing, so an invalid ID in a shared
 * (non-isolated) hook chain cannot take down unrelated work.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Upper bound on sessionID length. Harness IDs are short (UUID=36,
 * `ses_<alnum>` similar), so 128 is generous headroom; the cap is
 * belt-and-suspenders against pathologically long IDs.
 */
const MAX_SESSION_ID_LENGTH = 128;

interface SessionStorageOptions<TState, TSerialized = TState> {
  storageDir: string;
  serialize?: (state: TState, sessionID: string) => TSerialized;
  deserialize?: (data: TSerialized) => TState;
  /**
   * Controls how `load` handles a value thrown while reading/parsing.
   * - `"fallback"` (default): return defaultValue/null for any thrown value.
   * - `"rethrow-non-error"`: re-throw non-Error values, fall back on Errors.
   */
  onParseError?: "fallback" | "rethrow-non-error";
  /**
   * When true, `save` uses an unconditional recursive mkdir up front and retries
   * once on ENOENT (mkdir + re-write), tolerating a storageDir removed between
   * checks. Default false (directory is created only when missing).
   */
  retryOnENOENT?: boolean;
}

export function createSessionStorage<TState, TSerialized = TState>(
  options: SessionStorageOptions<TState, TSerialized> & {
    /** Must be structuredClone-compatible (no functions, symbols, or DOM nodes) */
    defaultValue: TState;
  }
): {
  load: (sessionID: string) => TState;
  save: (sessionID: string, state: TState) => void;
  clear: (sessionID: string) => void;
};

export function createSessionStorage<TState, TSerialized = TState>(
  options: SessionStorageOptions<TState, TSerialized>
): {
  load: (sessionID: string) => TState | null;
  save: (sessionID: string, state: TState) => void;
  clear: (sessionID: string) => void;
};

export function createSessionStorage<TState, TSerialized = TState>(
  options: SessionStorageOptions<TState, TSerialized> & {
    defaultValue?: TState;
  }
) {
  const {
    storageDir,
    defaultValue,
    serialize,
    deserialize,
    onParseError = "fallback",
    retryOnENOENT = false,
  } = options;

  const isValidSessionID = (id: string): boolean =>
    SAFE_SESSION_ID.test(id) && id.length <= MAX_SESSION_ID_LENGTH;

  // getPath assumes the caller has already validated sessionID via
  // isValidSessionID; it performs no checks of its own.
  const getPath = (sessionID: string) =>
    join(storageDir, `${sessionID}.json`);

  const fallback = (): TState | null =>
    defaultValue !== undefined ? structuredClone(defaultValue) : null;

  const load = (sessionID: string): TState | null => {
    if (!isValidSessionID(sessionID)) {
      log("[session-storage] rejected invalid sessionID (load)", { sessionID });
      return fallback();
    }
    const filePath = getPath(sessionID);
    if (!existsSync(filePath)) return fallback();
    try {
      const raw = JSON.parse(
        readFileSync(filePath, "utf-8")
      ) as TSerialized;
      return deserialize ? deserialize(raw) : (raw as unknown as TState);
    } catch (error) {
      if (onParseError === "rethrow-non-error" && !(error instanceof Error))
        throw error;
      return fallback();
    }
  };

  const save = (sessionID: string, state: TState): void => {
    if (!isValidSessionID(sessionID)) {
      log("[session-storage] rejected invalid sessionID (save)", { sessionID });
      return;
    }
    const filePath = getPath(sessionID);
    if (retryOnENOENT || !existsSync(storageDir))
      mkdirSync(storageDir, { recursive: true });
    const data = serialize
      ? serialize(state, sessionID)
      : (state as unknown as TSerialized);
    const json = JSON.stringify(data, null, 2);
    try {
      writeFileSync(filePath, json);
    } catch (error) {
      if (
        !retryOnENOENT ||
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      mkdirSync(storageDir, { recursive: true });
      writeFileSync(filePath, json);
    }
  };

  const clear = (sessionID: string): void => {
    if (!isValidSessionID(sessionID)) {
      log("[session-storage] rejected invalid sessionID (clear)", {
        sessionID,
      });
      return;
    }
    const filePath = getPath(sessionID);
    if (existsSync(filePath)) unlinkSync(filePath);
  };

  return { load, save, clear };
}
