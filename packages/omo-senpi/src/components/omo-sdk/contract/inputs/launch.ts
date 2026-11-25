import type { Readable } from "node:stream"

import { Type } from "typebox"

// LaunchOptions and the five launch operations of first-party design 6.9, under the security design's 4.4 and 5.5. Each
// operation takes the parts its mode admits; the parser's own refusals (fork with another session form, hand with
// headless) are scenarios, not schema. The provider key is never text: it is the engine's LaunchKeyHandle, streamed once
// onto a private descriptor of the launched process (slice E1a-s).
const closed = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
const Texts = Type.Array(Text, { minItems: 1 })
const Flag = Type.Optional(Type.Boolean())
const Optional = Type.Optional

export type LaunchKeyHandle = Readable | ReadableStream<Uint8Array>

const LaunchSession = Optional(
  Type.Object(
    {
      continue: Optional(Type.Literal(true)),
      path: Optional(Text),
      id: Optional(Text),
      fork: Optional(Text),
      rebind: Optional(Text),
      ephemeral: Optional(Type.Literal(true)),
      dir: Optional(Text),
      spawned_by: Optional(Type.Object({ parentSessionId: Text, rootSessionId: Text, taskId: Text }, closed)),
      name: Optional(Text),
    },
    closed,
  ),
)

const Paths = (extra: Record<string, ReturnType<typeof Optional>> = {}) =>
  Optional(Type.Object({ paths: Optional(Texts), none: Flag, ...extra }, closed))

export const LaunchSetup = Optional(
  Type.Object(
    {
      model: Optional(Text),
      provider: Optional(Text),
      model_patterns: Optional(Texts),
      reasoning: Optional(Text),
      system_prompt: Optional(Text),
      append_system_prompt: Optional(Text),
      tools: Optional(
        Type.Object({ allow: Optional(Texts), deny: Optional(Texts), none: Flag, no_builtin: Flag }, closed),
      ),
      extensions: Paths(),
      skills: Optional(Type.Object({ names: Optional(Texts), none: Flag }, closed)),
      prompt_templates: Paths(),
      themes: Paths({ use: Optional(Text) }),
      context_files: Flag,
      project_trust: Flag,
      offline: Flag,
      session_runtime: Optional(Type.Enum(["in-process", "worker"])),
      tool_runtime: Optional(Type.Enum(["in-process", "child"])),
      auto_title: Flag,
    },
    closed,
  ),
)

const LaunchInput = Type.Object(
  { messages: Optional(Type.Array(Type.String())), files: Optional(Texts), stdin: Flag },
  closed,
)
const Gated = Optional(Type.Object({ grok_neo: Flag }, closed))
const Presenter = Optional(Type.Object({ bootstrap_fd: Type.Literal(4), enforcement: Flag }, closed))
const ApiKey = Optional(Type.Unsafe<LaunchKeyHandle>({ type: "object" }))
const Listen = Optional(Text)

export const EngineLaunchInteractive = Type.Object({
  session: LaunchSession,
  setup: LaunchSetup,
  input: Optional(LaunchInput),
  gated: Gated,
  tui_mode: Optional(Type.Enum(["regular", "fullscreen"])),
  verbose: Flag,
  attach: Optional(Type.Object({ socket: Text }, closed)),
  presenter: Presenter,
  api_key: ApiKey,
})
export const EngineLaunchPrint = Type.Object({
  session: LaunchSession,
  setup: LaunchSetup,
  input: LaunchInput,
  gated: Gated,
  mode: Type.Enum(["text", "json"]),
  presenter: Presenter,
  api_key: ApiKey,
})
export const EngineLaunchRpc = Type.Object({
  session: LaunchSession,
  setup: LaunchSetup,
  gated: Gated,
  listen: Listen,
  multi_session: Flag,
  presenter: Presenter,
  input: Optional(LaunchInput),
  api_key: ApiKey,
})
export const EngineLaunchHand = Type.Object({
  session: LaunchSession,
  setup: LaunchSetup,
  input: Optional(LaunchInput),
  presenter: Presenter,
  gated: Gated,
  api_key: ApiKey,
})
export const EngineLaunchHeadless = Type.Object({
  session: LaunchSession,
  setup: LaunchSetup,
  listen: Listen,
  input: Optional(LaunchInput),
  presenter: Presenter,
  gated: Gated,
  api_key: ApiKey,
})
