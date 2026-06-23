import { CuratorLoop, type CuratorLoopConfig, type CuratorLoopState } from "./curator-loop"
import type { CuratorInvoker } from "./invoker"
import type { MemoryCoreService } from "../memory-core/service"

export interface CuratorLoopManagerDeps {
  service: MemoryCoreService
  invoker: CuratorInvoker
  config?: Partial<CuratorLoopConfig>
  log?: (message: string, ...args: unknown[]) => void
}

export class CuratorLoopManager {
  private readonly loop: CuratorLoop

  constructor(private readonly deps: CuratorLoopManagerDeps) {
    this.loop = new CuratorLoop({
      service: deps.service,
      invoker: deps.invoker,
      config: deps.config,
      log: deps.log,
    })
  }

  start(): void {
    this.loop.start()
  }

  stop(): void {
    this.loop.stop()
  }

  getState(): Readonly<CuratorLoopState> {
    return this.loop.getState()
  }

  async runOnce(): Promise<ReturnType<CuratorLoop["tick"]>> {
    return this.loop.tick()
  }
}
