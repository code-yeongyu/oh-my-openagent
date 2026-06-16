import type { OutputBatch, OutputLine } from "./types"

export type TimerHandle = ReturnType<typeof setTimeout> | number | { unref?(): void }

export interface SchedulerDeps {
  setTimer(fn: () => void, delayMs: number): TimerHandle
  clearTimer(handle: TimerHandle): void
  now(): number
}

export interface MonitorBatcherOptions {
  batchMaxLines: number
  batchMaxBytes: number
  flushIntervalMs: number
  scheduler?: SchedulerDeps
}

function createRealScheduler(): SchedulerDeps {
  return {
    setTimer(fn: () => void, delayMs: number): TimerHandle {
      const timer = setTimeout(fn, delayMs)
      timer.unref?.()
      return timer
    },
    clearTimer(handle: TimerHandle): void {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    now(): number {
      return Date.now()
    },
  }
}

export class MonitorBatcher {
  private readonly batchMaxLines: number
  private readonly batchMaxBytes: number
  private readonly flushIntervalMs: number
  private readonly scheduler: SchedulerDeps
  private readonly lines: OutputLine[] = []
  private batchCallback: ((batch: OutputBatch) => void) | undefined
  private batchSeq = 0
  private pendingBytes = 0
  private firstPendingAt: number | undefined
  private timer: TimerHandle | undefined
  private destroyed = false

  constructor(opts: MonitorBatcherOptions) {
    this.batchMaxLines = opts.batchMaxLines
    this.batchMaxBytes = opts.batchMaxBytes
    this.flushIntervalMs = opts.flushIntervalMs
    this.scheduler = opts.scheduler ?? createRealScheduler()
  }

  push(line: OutputLine): void {
    if (this.destroyed) {
      return
    }

    if (this.lines.length === 0) {
      this.firstPendingAt = this.scheduler.now()
      this.startTimer()
    }

    this.lines.push(line)
    this.pendingBytes += line.text.length

    if (this.lines.length >= this.batchMaxLines || this.pendingBytes >= this.batchMaxBytes) {
      this.flushNow()
    }
  }

  flushNow(): void {
    if (this.destroyed || this.lines.length === 0 || !this.batchCallback) {
      return
    }

    const lines = this.lines.splice(0)
    this.pendingBytes = 0
    this.firstPendingAt = undefined
    this.clearTimer()
    this.batchSeq += 1

    this.batchCallback({
      monitorId: "",
      batchSeq: this.batchSeq,
      lines,
      stillRunning: true,
    })
  }

  onBatch(cb: (batch: OutputBatch) => void): void {
    if (this.destroyed) {
      return
    }

    this.batchCallback = cb
    this.flushNow()
  }

  pendingCount(): number {
    return this.lines.length
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }

    this.destroyed = true
    this.clearTimer()
    this.lines.splice(0)
    this.pendingBytes = 0
    this.firstPendingAt = undefined
    this.batchCallback = undefined
  }

  private startTimer(): void {
    if (this.timer || this.flushIntervalMs <= 0) {
      return
    }

    const startedAt = this.firstPendingAt ?? this.scheduler.now()
    this.timer = this.scheduler.setTimer(() => {
      this.timer = undefined
      if (this.firstPendingAt === startedAt) {
        this.flushNow()
      }
    }, this.flushIntervalMs)
  }

  private clearTimer(): void {
    if (!this.timer) {
      return
    }

    this.scheduler.clearTimer(this.timer)
    this.timer = undefined
  }
}
