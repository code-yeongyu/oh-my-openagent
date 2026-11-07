import { createServer, type Server, type Socket } from "node:net"

// The writer's end of `\\.\pipe\omo-git-op-<op>` (design v4.2 section 6.4): created and listening before the helper is
// spawned, so its connection is never missed; exactly one connection is accepted. Frames from the helper are
// newline-terminated ASCII (`joined`, `error`, `cancelled`, `spawned`, `spawn-failed`, `exit`, `done`, ...).
export type ControlRead = string | "eof" | "timeout" | "interrupted"

export class HelperControl {
  private socket: Socket | undefined
  private pending = ""
  private readonly frames: string[] = []
  private ended = false
  private interrupted = false
  private wake: (() => void) | undefined

  private constructor(private readonly server: Server) {}

  static async listen(op: string): Promise<HelperControl> {
    const server = createServer()
    const control = new HelperControl(server)
    server.on("connection", (socket) => control.accept(socket))
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(`\\\\.\\pipe\\omo-git-op-${op}`, () => {
        server.off("error", reject)
        resolve()
      })
    })
    server.on("error", () => control.finish())
    return control
  }

  private accept(socket: Socket): void {
    if (this.socket !== undefined || this.ended) {
      socket.destroy()
      return
    }
    this.socket = socket
    this.server.close()
    socket.on("data", (chunk: Buffer) => {
      this.pending += chunk.toString("utf8")
      for (let end = this.pending.indexOf("\n"); end >= 0; end = this.pending.indexOf("\n")) {
        this.frames.push(this.pending.slice(0, end))
        this.pending = this.pending.slice(end + 1)
      }
      this.notify()
    })
    socket.on("error", () => this.finish())
    socket.on("end", () => this.finish())
    socket.on("close", () => this.finish())
  }

  private finish(): void {
    this.ended = true
    this.notify()
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  /** True once the pipe has seen end/close, or the helper died before it ever connected. */
  get closed(): boolean {
    return this.ended
  }

  /** The helper process is gone: a pipe it never connected will never deliver anything. */
  helperGone(): void {
    if (this.socket === undefined) this.finish()
  }

  /** Ends the current (or else the next) wait once with `interrupted`: an abort before `go`. */
  interrupt(): void {
    this.interrupted = true
    this.notify()
  }

  async next(boundMs?: number): Promise<ControlRead> {
    for (;;) {
      const frame = this.frames.shift()
      if (frame !== undefined) return frame
      if (this.interrupted) {
        this.interrupted = false
        return "interrupted"
      }
      if (this.ended) return "eof"
      const woke = await new Promise<boolean>((resolve) => {
        const timer = boundMs === undefined ? undefined : setTimeout(() => resolve(false), boundMs)
        this.wake = () => {
          clearTimeout(timer)
          resolve(true)
        }
      })
      if (!woke) return "timeout"
    }
  }

  /** Writes frames; false when the helper's end is gone, so the bytes cannot have reached it. */
  send(text: string): Promise<boolean> {
    const socket = this.socket
    if (socket === undefined || this.ended || socket.destroyed) return Promise.resolve(false)
    return new Promise((resolve) => socket.write(text, (error) => resolve(error === undefined || error === null)))
  }

  dispose(): void {
    this.ended = true
    this.socket?.destroy()
    if (this.server.listening) this.server.close()
  }
}
