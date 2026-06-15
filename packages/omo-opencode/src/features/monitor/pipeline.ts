import type { MonitorBatcher } from "./batcher"
import type { LineStream, LineStreamResult } from "./line-stream"
import type { MonitorRingBuffer } from "./ring-buffer"
import type { MonitorCounters, OutputBatch, OutputLine, OutputStreamType } from "./types"

interface MonitorFilter {
  matches(text: string): boolean
}

interface MonitorPipelineComponents {
  lineStream: Record<OutputStreamType, LineStream>
  filter: MonitorFilter
  ring: MonitorRingBuffer
  batcher: MonitorBatcher
}

interface MonitorPipelineDeps {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  log(error: unknown): void
}

interface MonitorPipeline {
  onBatch(cb: (batch: OutputBatch) => void): void
  counters(): MonitorCounters
  isStopped(): boolean
  stop(): void
}

type ByteStreamReader = ReturnType<ReadableStream<Uint8Array>["getReader"]>

export function createMonitorPipeline(
  components: MonitorPipelineComponents,
  deps: MonitorPipelineDeps,
): MonitorPipeline {
  const readers = new Set<ByteStreamReader>()
  let stopped = false
  let nextSequence = 1

  function pushDecodedLine(stream: OutputStreamType, decodedLine: { text: string; truncated?: boolean }): void {
    if (stopped) {
      return
    }

    const outputLine: OutputLine = {
      stream,
      seq: nextSequence,
      text: decodedLine.text,
    }
    nextSequence += 1

    if (decodedLine.truncated) {
      outputLine.truncated = true
    }

    const matched = components.filter.matches(outputLine.text)
    components.ring.push(outputLine, matched)
    if (matched) {
      components.batcher.push(outputLine)
    }
  }

  function consumeLineStreamResult(stream: OutputStreamType, result: LineStreamResult): void {
    for (const decodedLine of result.lines) {
      pushDecodedLine(stream, decodedLine)
    }
  }

  function flushLineStream(stream: OutputStreamType): void {
    consumeLineStreamResult(stream, components.lineStream[stream].flush())
  }

  function flushAllLineStreams(): void {
    flushLineStream("stdout")
    flushLineStream("stderr")
  }

  function cancelReaders(): void {
    for (const reader of readers) {
      void reader.cancel().catch((error) => deps.log(error))
    }
  }

  function finish(): void {
    if (stopped) {
      return
    }

    components.batcher.flushNow()
    stopped = true
  }

  function stopReading(): void {
    if (stopped) {
      return
    }

    flushAllLineStreams()
    components.batcher.flushNow()
    stopped = true
    cancelReaders()
  }

  async function readStream(
    stream: OutputStreamType,
    input: ReadableStream<Uint8Array>,
    lineStream: LineStream,
  ): Promise<void> {
    const reader = input.getReader()
    readers.add(reader)

    try {
      while (!stopped) {
        const result = await reader.read()
        if (stopped) {
          break
        }

        if (result.done) {
          flushLineStream(stream)
          break
        }

        consumeLineStreamResult(stream, lineStream.feed(result.value))
      }
    } finally {
      readers.delete(reader)
      reader.releaseLock()
    }
  }

  async function readLoop(): Promise<void> {
    await Promise.all([
      readStream("stdout", deps.stdout, components.lineStream.stdout),
      readStream("stderr", deps.stderr, components.lineStream.stderr),
    ])
    finish()
  }

  void readLoop().catch((error) => {
    if (stopped) {
      return
    }

    deps.log(error)
    components.batcher.flushNow()
    stopped = true
    cancelReaders()
  })

  return {
    onBatch(cb: (batch: OutputBatch) => void): void {
      components.batcher.onBatch(cb)
    },
    counters(): MonitorCounters {
      return components.ring.getCounters()
    },
    isStopped(): boolean {
      return stopped
    },
    stop(): void {
      stopReading()
    },
  }
}
