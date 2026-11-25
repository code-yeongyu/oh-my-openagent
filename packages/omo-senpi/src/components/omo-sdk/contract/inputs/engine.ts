import { Type } from "typebox"

// The engine calls of first-party design 6.8 that carry no credential or launch option. `trust` is the project-trust
// choice of --approve and --no-approve, kept in the type as ruled; who may pass it is wired later. The launch `setup`
// of models.list and promptSizes is held for P1a-s.
const None = Type.Object({})
const Source = Type.String({ minLength: 1 })
const Local = Type.Optional(Type.Boolean())
const Trust = Type.Optional(Type.Boolean())
const Count = Type.Integer({ minimum: 1 })

export const EngineConfigAgentDir = None
export const EngineConfigResources = Type.Object({ local: Local, trust: Trust })
/** Global takes `enabled`; project-local (`local: true`) takes `state`, since a boolean cannot express `inherit`. */
export const EngineConfigSetResource = Type.Object({
  local: Local,
  trust: Trust,
  source: Source,
  resource: Type.Object(
    { type: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  enabled: Type.Optional(Type.Boolean()),
  state: Type.Optional(Type.Union([Type.Literal("inherit"), Type.Literal("load"), Type.Literal("unload")])),
})
export const EngineModelsDiscover = Type.Object({ provider: Type.String({ minLength: 1 }) })
export const EngineModelsList = Type.Object({ pattern: Type.Optional(Type.String({ minLength: 1 })) })
export const EngineModelsUpdate = None
export const EnginePackagesInstall = Type.Object({ source: Source, local: Local, trust: Trust })
export const EnginePackagesRemove = Type.Object({ source: Source, local: Local, trust: Trust })
export const EnginePackagesList = Type.Object({ trust: Trust })
export const EnginePackagesUpdate = Type.Object({ source: Type.Optional(Source), trust: Trust })
export const EnginePromptSizes = None
export const EngineTips = None
export const EngineScheduleList = None
export const EngineScheduleCancel = Type.Object({ id: Type.String({ minLength: 1 }) })
export const EngineScheduleRun = Type.Object({
  watch: Type.Optional(Type.Boolean()),
  exec: Type.Optional(Type.String({ minLength: 1 })),
  poll_seconds: Type.Optional(Count),
  timeout_seconds: Type.Optional(Count),
  concurrency: Type.Optional(Count),
  signal: Type.Optional(Type.Unsafe<AbortSignal>({})),
})
export const EngineSessionOfPid = Type.Object({ pid: Count })
export const EngineSessionsExportHtml = Type.Object({
  session: Type.String({ minLength: 1, description: "A session file." }),
  out: Type.Optional(Type.String({ minLength: 1 })),
})
