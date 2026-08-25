import { createServer, type AddressInfo, type Server, type Socket } from "node:net"

const CLEANUP_WAIT_MS = 5_000

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
  readonly settled: boolean
}

export function createMemoryRunSupervisorIc8ExitResources(waitMs: number) {
  const exitServers = new Set<Server>()
  const exitServerClosures = new Map<Server, Promise<void>>()
  const acceptedSockets = new Set<Socket>()
  const socketClosures = new Map<Socket, Promise<void>>()
  const childExitTimeouts = new Set<ReturnType<typeof setTimeout>>()
  const signalSettlers = new Set<() => void>()

  const clearTrackedTimeout = (timeout: ReturnType<typeof setTimeout>) => {
    clearTimeout(timeout)
    childExitTimeouts.delete(timeout)
  }

  const waitBounded = <T>(
    signal: Promise<T>,
    timeoutMs: number,
    description: string,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        childExitTimeouts.delete(timeout)
        reject(new Error(`waited ${timeoutMs}ms for ${description}`))
      }, timeoutMs)
      childExitTimeouts.add(timeout)
      signal.then(
        (value) => {
          clearTrackedTimeout(timeout)
          resolve(value)
        },
        (error: unknown) => {
          clearTrackedTimeout(timeout)
          reject(error)
        },
      )
    })

  const closeExitServer = async (server: Server): Promise<void> => {
    const existing = exitServerClosures.get(server)
    if (existing !== undefined) return existing
    if (!server.listening) {
      server.removeAllListeners()
      exitServers.delete(server)
      return
    }
    const closing = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    exitServerClosures.set(server, closing)
    try {
      await closing
    } finally {
      server.removeAllListeners()
      exitServerClosures.delete(server)
      exitServers.delete(server)
    }
  }

  const openServer = async () => {
    const server = createServer()
    exitServers.add(server)
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error)
      server.once("error", onError)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onError)
        resolve()
      })
    })
    const address = server.address() as AddressInfo
    server.on("connection", (socket) => {
      acceptedSockets.add(socket)
      socketClosures.set(
        socket,
        new Promise<void>((resolve) =>
          socket.once("close", () => {
            acceptedSockets.delete(socket)
            socketClosures.delete(socket)
            resolve()
          }),
        ),
      )
    })
    const exitSocketAccepted = deferred<Socket>()
    const childExited = deferred<void>()
    void exitSocketAccepted.promise.catch(() => {})
    void childExited.promise.catch(() => {})
    server.once("connection", (socket) => exitSocketAccepted.resolve(socket))
    const timeout = setTimeout(() => {
      childExitTimeouts.delete(timeout)
      childExited.reject(new Error(`waited ${waitMs}ms for model child exit`))
    }, waitMs)
    childExitTimeouts.add(timeout)
    const settleForCleanup = () => {
      const error = new Error("exit resource cleaned up before model child exit")
      exitSocketAccepted.reject(error)
      childExited.reject(error)
      clearTrackedTimeout(timeout)
    }
    signalSettlers.add(settleForCleanup)
    void exitSocketAccepted.promise
      .then(async (socket) => {
        const closed = socketClosures.get(socket)
        if (closed === undefined) throw new Error("accepted model socket is not tracked")
        const serverClosed = closeExitServer(server)
        await closed
        await serverClosed
        clearTrackedTimeout(timeout)
        signalSettlers.delete(settleForCleanup)
        childExited.resolve()
      })
      .catch((error: unknown) => {
        clearTrackedTimeout(timeout)
        signalSettlers.delete(settleForCleanup)
        childExited.reject(error instanceof Error ? error : new Error(String(error)))
      })
    return {
      port: address.port,
      childExited: childExited.promise,
      exitSocketAccepted: exitSocketAccepted.promise,
    }
  }

  const cleanup = async (): Promise<{ forcedSocketDestructions: number }> => {
    let cleanupError: Error | undefined
    let forcedSocketDestructions = 0
    try {
      try {
        if (socketClosures.size > 0) {
          await waitBounded(
            Promise.all([...socketClosures.values()]).then(() => undefined),
            CLEANUP_WAIT_MS,
            "model socket close",
          )
        }
      } catch {
        for (const socket of acceptedSockets) {
          forcedSocketDestructions += 1
          socket.destroy()
        }
        try {
          await waitBounded(
            Promise.all([...socketClosures.values()]).then(() => undefined),
            CLEANUP_WAIT_MS,
            "forced model socket close",
          )
        } catch (error) {
          cleanupError = error instanceof Error ? error : new Error(String(error))
        }
      }
      try {
        await waitBounded(
          Promise.all([...exitServers].map(closeExitServer)).then(() => undefined),
          CLEANUP_WAIT_MS,
          "exit server close",
        )
      } catch (error) {
        cleanupError ??= error instanceof Error ? error : new Error(String(error))
      }
    } finally {
      for (const settle of signalSettlers) settle()
      for (const socket of acceptedSockets) {
        socket.removeAllListeners()
        socket.destroy()
      }
      for (const server of exitServers) server.removeAllListeners()
      acceptedSockets.clear()
      socketClosures.clear()
      signalSettlers.clear()
      exitServers.clear()
      exitServerClosures.clear()
      for (const timeout of childExitTimeouts) clearTimeout(timeout)
      childExitTimeouts.clear()
    }
    if (cleanupError !== undefined) throw cleanupError
    return { forcedSocketDestructions }
  }

  return {
    cleanup,
    clearTrackedTimeout,
    counts: () => ({
      exitServers: exitServers.size,
      acceptedSockets: acceptedSockets.size,
      childExitTimeouts: childExitTimeouts.size,
    }),
    hasConnectedSockets: () => acceptedSockets.size > 0,
    openServer,
    trackTimeout: (timeout: ReturnType<typeof setTimeout>) =>
      childExitTimeouts.add(timeout),
    waitBounded,
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {}
  let rejectPromise: (error: Error) => void = () => {}
  let settled = false
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    },
    reject: (error) => {
      if (settled) return
      settled = true
      rejectPromise(error)
    },
    get settled() {
      return settled
    },
  }
}
