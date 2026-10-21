import { basename } from "node:path"
import { fileURLToPath } from "node:url"

const FRAME_END = "__CI_SAMPLE_END__"

// Capture errors record only the error name, so sampler conditions carry theirs there.
function samplerError(name) {
  const error = new Error(name)
  error.name = name
  return error
}

// One long-lived probe process per invocation; it exits by itself once its owner is gone.
function samplerCommand(intervalMs, ownerPid) {
  if (process.platform === "win32") {
    return [
      "pwsh", "-NoProfile", "-NonInteractive", "-File",
      fileURLToPath(new URL("./ci-test-processes.ps1", import.meta.url)),
      "-IntervalMs", String(intervalMs), "-OwnerPid", String(ownerPid),
    ]
  }
  return [
    "/bin/sh", "-c",
    `while kill -0 "$1" 2>/dev/null; do ps -axo pid=,ppid=,lstart=,%cpu=,rss=,comm= || exit 1; echo ${FRAME_END}; sleep "$2"; done`,
    "ci-test-sampler", String(ownerPid), String(intervalMs / 1000),
  ]
}

function parsePosixRow(line) {
  const match = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line)
  if (!match) throw new SyntaxError("process-probe-format")
  return {
    pid: Number(match[1]), parentPid: Number(match[2]),
    creationTimeUtc: new Date(match[3]).toISOString(),
    name: basename(match[6]), cpuPercent: Number(match[4]), rssBytes: Number(match[5]) * 1024,
  }
}

export function startSampler({ intervalMs = 2000, onFrame, onError }) {
  const probe = Bun.spawn(samplerCommand(intervalMs, process.pid), {
    stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" },
  })
  let stopping = false
  let markFirstFrame
  const firstFrame = new Promise((resolve) => { markFirstFrame = resolve })
  const deliver = (table) => {
    onFrame(table)
    markFirstFrame()
  }
  const reading = (async () => {
    const decoder = new TextDecoder()
    let pending = ""
    let rows = []
    for await (const chunk of probe.stdout) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          if (process.platform === "win32") deliver(JSON.parse(line))
          else if (line === FRAME_END) {
            deliver(rows)
            rows = []
          } else rows.push(parsePosixRow(line))
        } catch (error) {
          rows = []
          onError("sample", error)
        }
      }
    }
  })().catch((error) => onError("sampler-read", error))
  const exited = probe.exited.then((code) => {
    if (!stopping && code !== 0) onError("sampler", samplerError("SamplerExited"))
  })
  return {
    pid: probe.pid,
    // A run shorter than the probe's start-up still gets one frame; the wait is bounded and ends early if the probe dies.
    async stop({ firstFrameTimeoutMs = 15000 } = {}) {
      let timer
      const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), firstFrameTimeoutMs) })
      const outcome = await Promise.race([firstFrame, timedOut, exited.then(() => "exited")])
      clearTimeout(timer)
      if (outcome === "timeout") onError("sampler", samplerError("FirstFrameTimeout"))
      stopping = true
      probe.kill()
      await Promise.all([reading, exited])
    },
  }
}
