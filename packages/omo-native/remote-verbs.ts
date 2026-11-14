import { SESSION_VERBS } from "./remote-session-args"

/** Every `omo remote` verb the CLI dispatches; `attach` launches the engine and is dispatched before this table. */
export const VERBS = ["status", "devices", "sessions", "enable", "disable", "control", "bootstrap", ...SESSION_VERBS] as const

/**
 * The verbs whose whole call path is the account read plus the local API (omo#13440): they open no network connection
 * in this process. A verb that reaches the network belongs in NETWORK_REMOTE_VERBS; the two lists partition VERBS.
 */
export const LOCAL_ONLY_REMOTE_VERBS = [
  "status",
  "devices",
  "sessions",
  "enable",
  "disable",
  "control",
  "open",
  "send",
  "model",
  "interrupt",
  "close",
] as const satisfies readonly (typeof VERBS)[number][]

/** Verbs that reach the network themselves: `bootstrap` downloads and installs the pinned device service. */
export const NETWORK_REMOTE_VERBS = ["bootstrap"] as const satisfies readonly (typeof VERBS)[number][]
