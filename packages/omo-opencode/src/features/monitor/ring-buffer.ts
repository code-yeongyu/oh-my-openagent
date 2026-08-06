import type { MonitorCounters, MonitorOutputResult, OutputLine } from "./types"

type MonitorRingStream = "matched" | "unmatched" | "all"

interface MonitorRingBufferOptions {
  ringMaxLines: number
}

interface MonitorRingQueryOptions {
  stream: MonitorRingStream
  since_sequence?: number
  limit?: number
}

export class MonitorRingBuffer {
  private readonly ringMaxLines: number
  private readonly matchedLines: OutputLine[] = []
  private readonly unmatchedLines: OutputLine[] = []
  private counters: MonitorCounters = createEmptyCounters()

  constructor(opts: MonitorRingBufferOptions) {
    this.ringMaxLines = opts.ringMaxLines
  }

  push(line: OutputLine, matched: boolean): void {
    this.counters.totalLines += 1
    this.counters.lastSequence = Math.max(this.counters.lastSequence, line.seq)

    if (matched) {
      this.counters.matchedLines += 1
      this.pushMatched(line)
      return
    }

    this.counters.unmatchedLines += 1
    this.pushUnmatched(line)
  }

  query(opts: MonitorRingQueryOptions): MonitorOutputResult {
    const lines = this.selectLines(opts.stream)
    const sinceSequence = opts.since_sequence
    const sinceFilteredLines = sinceSequence === undefined ? lines : lines.filter((line) => line.seq > sinceSequence)
    const limitedLines = opts.limit === undefined ? sinceFilteredLines : sinceFilteredLines.slice(-opts.limit)

    return {
      lines: limitedLines,
      counters: this.getCounters(),
    }
  }

  getCounters(): MonitorCounters {
    return { ...this.counters }
  }

  reset(): void {
    this.matchedLines.length = 0
    this.unmatchedLines.length = 0
    this.counters = createEmptyCounters()
  }

  private pushMatched(line: OutputLine): void {
    if (this.matchedLines.length >= this.ringMaxLines) {
      const droppedLine = this.matchedLines.shift()
      if (droppedLine) {
        this.counters.droppedMatched += 1
        this.counters.bytesDropped += droppedLine.text.length
      }
    }

    this.matchedLines.push(line)
  }

  private pushUnmatched(line: OutputLine): void {
    if (this.unmatchedLines.length >= this.ringMaxLines) {
      const droppedLine = this.unmatchedLines.shift()
      if (droppedLine) {
        this.counters.droppedUnmatched += 1
        this.counters.bytesDropped += droppedLine.text.length
      }
    }

    this.unmatchedLines.push(line)
  }

  private selectLines(stream: MonitorRingStream): OutputLine[] {
    if (stream === "matched") {
      return [...this.matchedLines]
    }

    if (stream === "unmatched") {
      return [...this.unmatchedLines]
    }

    return [...this.matchedLines, ...this.unmatchedLines].sort((left, right) => left.seq - right.seq)
  }
}

function createEmptyCounters(): MonitorCounters {
  return {
    totalLines: 0,
    matchedLines: 0,
    unmatchedLines: 0,
    droppedMatched: 0,
    droppedUnmatched: 0,
    bytesDropped: 0,
    lastSequence: 0,
  }
}
