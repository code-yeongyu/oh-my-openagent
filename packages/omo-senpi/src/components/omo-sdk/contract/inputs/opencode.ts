import { Type } from "typebox"

// The OpenCode-edition calls of first-party design 6.11. codex_autonomous on install.plugin is slice P1a-s's (security
// design 4.4): who may pass it is the principal matrix. The provider inputs are the twelve keys of InstallArgs, as the registry enumerates them.
const YesNo = Type.Optional(Type.Enum(["no", "yes"]))
const Path = Type.String({ minLength: 1 })
const Platform = Type.Enum(["opencode", "codex", "both", "native", "native-dev"])

export const InstallPlugin = Type.Object({
  interactive: Type.Boolean(),
  platform: Type.Optional(Platform),
  claude: Type.Optional(Type.Enum(["no", "yes", "max20"])),
  openai: YesNo,
  gemini: YesNo,
  copilot: YesNo,
  opencodeZen: YesNo,
  zaiCodingPlan: YesNo,
  kimiForCoding: YesNo,
  opencodeGo: YesNo,
  bailianCodingPlan: YesNo,
  minimaxCnCodingPlan: YesNo,
  minimaxCodingPlan: YesNo,
  vercelAiGateway: YesNo,
  codex_autonomous: Type.Optional(Type.Boolean()),
  skip_auth: Type.Boolean(),
})
export const InstallCleanup = Type.Object({
  platform: Type.Optional(Platform),
  codex_home: Type.Optional(Path),
  project: Type.Optional(Path),
})
export const InstallLocalVersion = Type.Object({ directory: Type.Optional(Path) })
export const BoulderStatus = Type.Object({
  directory: Type.Optional(Path),
  work_id: Type.Optional(Type.String({ minLength: 1 })),
})
export const WorktreesSweep = Type.Object({
  apply: Type.Optional(Type.Boolean()),
  older_than_days: Type.Optional(Type.Integer({ minimum: 0 })),
  repos: Type.Optional(Type.Array(Path, { minItems: 1 })),
})
export const ToolkitHelp = Type.Object({})
