export type DirectoryQuery = {
  query?: { directory?: string } & Record<string, unknown>
}

export function withDirectoryArgs(
  args: DirectoryQuery | undefined,
  directory: string,
): DirectoryQuery {
  if (!args) return { query: { directory } }

  const query =
    typeof args.query === "object" && args.query ? args.query : undefined

  // Preserve caller-provided query.directory (even if it differs).
  if (query && "directory" in query) return args

  return { ...args, query: { ...query, directory } }
}

const DEFAULT_SESSION_METHODS_NEEDING_DIRECTORY = new Set<string>([
  "get",
  "messages",
  "prompt",
  "summarize",
  "create",
  "abort",
  "status",
  "todo",
  "children",
  "promptAsync",
  "message",
  "diff",
  "fork",
  "init",
  "command",
  "shell",
  "revert",
  "unrevert",
  "share",
  "unshare",
  "update",
  "delete",
  "list",
])

export function wrapSessionWithDirectory<T extends object>(
  session: T,
  directory: string,
  methodsNeedingDirectory: ReadonlySet<string> =
    DEFAULT_SESSION_METHODS_NEEDING_DIRECTORY,
): T {
  return new Proxy(session, {
    get(target, prop) {
      const value = target[prop as keyof T]
      if (typeof value !== "function") return value

      const key = typeof prop === "string" ? prop : undefined
      if (!key || !methodsNeedingDirectory.has(key)) {
        return value.bind(target)
      }

      return (args?: DirectoryQuery) => {
        const next = withDirectoryArgs(args, directory)
        const fn = value as (input: DirectoryQuery) => unknown
        return fn.call(target, next)
      }
    },
  })
}

function cloneWithPrototype<T extends object>(input: T): T {
  const clone = Object.create(Object.getPrototypeOf(input)) as T
  Object.assign(clone, input)
  return clone
}

export function createDirectoryBoundClient<T extends { session?: unknown }>(
  client: T,
  directory: string,
): T {
  if (!client.session || typeof client.session !== "object") return client

  const session = client.session as object
  const wrappedSession = wrapSessionWithDirectory(session, directory)

  const next = cloneWithPrototype(client)
  ;(next as { session: unknown }).session = wrappedSession
  return next
}
