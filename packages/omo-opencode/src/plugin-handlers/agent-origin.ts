import path from "node:path"

const originKey = Symbol.for("opencode.agent-origins.v1")

export function hostAgentOrigins(config: Record<string, unknown>): unknown {
  return Object.getOwnPropertyDescriptor(config, originKey)?.value
}

export function isProjectAgentOrigin(config: Record<string, unknown>, directory: string, name: string): boolean {
  const origins = hostAgentOrigins(config)
  if (typeof origins !== "object" || origins === null || !Object.hasOwn(origins, name)) return false
  const source = Reflect.get(origins, name)
  if (typeof source !== "string" || !path.isAbsolute(source)) return false
  const relative = path.relative(path.resolve(directory, ".opencode", "agents"), source)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
