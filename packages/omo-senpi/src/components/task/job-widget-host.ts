// The slice of senpi's job-widget host API (root export of `@code-yeongyu/senpi`, senpi#4677) omo uses,
// declared structurally and read off the loaded module at runtime: a senpi that predates the API
// simply has no such exports, and omo then registers nothing (no author route, no task widgets).
// Inside senpi the module import resolves to the host's own loaded module.

export interface JobWidgetTextChunk {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly open: boolean
}

export interface JobWidgetTextSource {
  readonly id: string
  readonly label: string
  read(from: number): JobWidgetTextChunk
}

export interface JobWidgetTextTap extends JobWidgetTextSource {
  append(text: string): void
  close(): void
}

export interface JobWidgetBriefText {
  readonly command?: string
  readonly task?: string
  readonly intent?: string
  readonly watch?: string
  readonly stage?: string
}

export interface JobWidgetSourceHandle {
  notify(): void
  update(brief: JobWidgetBriefText): void
  settle(): void
  dispose(): void
}

export interface JobWidgetSourceRegistration {
  readonly sessionId: string
  readonly id: string
  readonly kind: "bash" | "task"
  readonly sources: readonly JobWidgetTextSource[]
  readonly brief: JobWidgetBriefText
  readonly startedAtMs?: number
}

export interface JobWidgetAuthorContext {
  readonly cwd: string
  readonly modelRegistry: {
    readonly getAvailable: () => unknown
    readonly find: (provider: string, modelId: string) => unknown
  }
}

export type JobWidgetAuthorResolver = (ctx: JobWidgetAuthorContext) => unknown

export interface JobWidgetSourcesApi {
  readonly register: (registration: JobWidgetSourceRegistration) => JobWidgetSourceHandle | undefined
  readonly createTap: (id: string, label: string) => JobWidgetTextTap
}

export interface JobWidgetHostApi {
    readonly setAuthorResolver?: (resolver: JobWidgetAuthorResolver | undefined) => () => void
    readonly sources?: JobWidgetSourcesApi
}

type TextTapConstructor = new (id: string, label: string) => JobWidgetTextTap

// One host object per loaded module, so per-host state (the author route) is shared by every session
// on the same senpi and never by two different hosts.
const hostsByModule = new WeakMap<object, JobWidgetHostApi>()

export function readJobWidgetHost(module: unknown): JobWidgetHostApi {
  if (typeof module !== "object" || module === null) return {}
  const cached = hostsByModule.get(module)
  if (cached !== undefined) return cached
  const host = buildJobWidgetHost(module)
  hostsByModule.set(module, host)
  return host
}

function buildJobWidgetHost(module: object): JobWidgetHostApi {
  const setAuthorResolver: unknown = Reflect.get(module, "setJobWidgetAuthorResolver")
  const register: unknown = Reflect.get(module, "registerJobWidgetSource")
  const textTap: unknown = Reflect.get(module, "TextTap")
  return {
    ...(typeof setAuthorResolver === "function"
      ? { setAuthorResolver: (resolver: JobWidgetAuthorResolver | undefined) => setAuthorResolver(resolver) as () => void }
      : {}),
    ...(typeof register === "function" && typeof textTap === "function"
      ? {
          sources: {
            register: (registration: JobWidgetSourceRegistration) =>
              register(registration) as JobWidgetSourceHandle | undefined,
            createTap: (id: string, label: string) => new (textTap as TextTapConstructor)(id, label),
          },
        }
      : {}),
  }
}

export async function loadJobWidgetHost(): Promise<JobWidgetHostApi> {
  return readJobWidgetHost(await import("@code-yeongyu/senpi"))
}
