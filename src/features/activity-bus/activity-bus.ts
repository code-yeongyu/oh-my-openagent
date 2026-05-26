import type { ActivityEvent, ActivityHandler, UnsubscribeFn } from "./types";

export class ActivityBus {
  private handlers = new Map<string, Set<ActivityHandler>>();
  private anyHandlers = new Set<ActivityHandler>();
  private buffer: ActivityEvent[] = [];
  private readonly maxBuffer = 100;
  private currentTime: () => number;

  constructor(currentTime?: () => number) {
    this.currentTime = currentTime ?? (() => Date.now());
  }

  async emit(event: Omit<ActivityEvent, "timestamp">): Promise<void> {
    const fullEvent = { ...event, timestamp: this.currentTime() } as ActivityEvent;

    this.buffer.push(fullEvent);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    const handlers = this.handlers.get(event.kind);
    const allHandlers: ActivityHandler[] = [
      ...(handlers ?? []),
      ...this.anyHandlers,
    ];

    await Promise.all(
      allHandlers.map(async (handler) => {
        try {
          await handler(fullEvent);
        } catch (err) {
          console.error(`[ActivityBus] Handler error for ${event.kind}:`, err);
        }
      })
    );
  }

  on(type: string, handler: ActivityHandler): UnsubscribeFn {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);

    return () => {
      this.off(type, handler);
    };
  }

  off(type: string, handler: ActivityHandler): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  onAny(handler: ActivityHandler): UnsubscribeFn {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  getRecentEvents(type?: string, limit?: number): ActivityEvent[] {
    let events = type
      ? this.buffer.filter((e) => e.kind === type)
      : [...this.buffer];
    if (limit !== undefined && limit >= 0) {
      events = events.slice(-limit);
    }
    return events;
  }

  getSnapshot(): { running: number; queued: number } {
    let running = 0;
    let queued = 0;

    for (const event of this.buffer) {
      if (event.kind === "task:created") {
        running++;
      } else if (event.kind === "task:completed" || event.kind === "task:error") {
        running--;
      }
    }

    queued = Math.max(0, running);
    return { running: queued, queued: 0 };
  }

  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
    this.buffer = [];
  }
}

export function createActivityBus(currentTime?: () => number): ActivityBus {
  return new ActivityBus(currentTime);
}
