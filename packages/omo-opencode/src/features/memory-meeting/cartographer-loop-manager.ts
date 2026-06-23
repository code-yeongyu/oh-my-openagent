import {
  CartographerLoop,
  type CartographerLoopConfig,
  type CartographerLoopDeps,
  type CartographerLoopState,
} from "./cartographer-loop"

export interface CartographerLoopManagerDeps extends Omit<CartographerLoopDeps, "config"> {
  config?: Partial<CartographerLoopConfig>
}

export class CartographerLoopManager {
  private readonly loop: CartographerLoop

  constructor(private readonly deps: CartographerLoopManagerDeps) {
    this.loop = new CartographerLoop({
      service: deps.service,
      invoker: deps.invoker,
      inboxDeps: deps.inboxDeps,
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

  getState(): Readonly<CartographerLoopState> {
    return this.loop.getState()
  }

  async runOnce(): Promise<ReturnType<CartographerLoop["tick"]>> {
    return this.loop.tick()
  }
}
