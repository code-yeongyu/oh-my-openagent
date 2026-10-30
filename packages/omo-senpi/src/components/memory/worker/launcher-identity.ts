export interface ReflectionLauncher {
  readonly runtime: string
  readonly execPath: string
  readonly pid: number
  readonly sessionId?: string
}

export function describeReflectionLauncher(input: {
  readonly env: NodeJS.ProcessEnv
  readonly execPath: string
  readonly pid: number
  readonly sessionId?: string
}): ReflectionLauncher {
  const runtimeRoot = [input.env.OMO_PACKAGE_DIR, input.env.SENPI_PACKAGE_DIR, input.env.PI_PACKAGE_DIR]
    .find((value) => value !== undefined && value.trim().length > 0)
  const brandedRuntime = readBrandedRuntime(input.env.SENPI_BRAND)
  const runtime = brandedRuntime ?? basename(runtimeRoot ?? input.execPath)
  return {
    runtime,
    execPath: input.execPath,
    pid: input.pid,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  }
}

function readBrandedRuntime(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.displayVersion !== "string") return undefined
    const runtime = parsed.displayVersion.trim()
    return runtime.length === 0 || runtime === "unknown" ? undefined : runtime
  } catch {
    return undefined
  }
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/")
  const name = normalized.slice(normalized.lastIndexOf("/") + 1)
  return name.length === 0 ? normalized : name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
