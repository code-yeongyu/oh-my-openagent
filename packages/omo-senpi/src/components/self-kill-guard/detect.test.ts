import { describe, expect, it } from "bun:test"

import { detectSelfTerminatingCommand, splitCommandSegments } from "./detect"

describe("splitCommandSegments", () => {
  it("splits on logical command separators", () => {
    expect(splitCommandSegments("taskkill /F /IM node.exe 2>&1 | tail -3; echo done")).toEqual([
      "taskkill /F /IM node.exe 2>&1",
      "tail -3",
      "echo done",
    ])
  })

  it("returns an empty list for an empty command", () => {
    expect(splitCommandSegments("")).toEqual([])
    expect(splitCommandSegments("   ")).toEqual([])
  })
})

describe("detectSelfTerminatingCommand", () => {
  const blockedKeys = [
    "taskkill-image-node",
    "node-pid-kill-loop",
    "pkill-node",
    "killall-node",
    "tskill-node",
    "stop-process-node",
    "wmic-node-delete",
    "powershell-get-process-stop",
  ]

  describe.each(blockedKeys)("rule %s", (key) => {
    it("reports a stable key and reason", () => {
      const command = blockedCommands()[key]
      const detection = detectSelfTerminatingCommand(command)
      expect(detection?.key).toBe(key)
      expect(detection?.reason.length).toBeGreaterThan(0)
    })
  })

  function blockedCommands(): Record<string, string> {
    return {
      // Verbatim from the 2026-07-30/31 incident session
      "taskkill-image-node": "taskkill /F /IM node.exe /T 2>&1 | tail -3; sleep 3; echo done",
      "node-pid-kill-loop":
        "for pid in $(tasklist 2>/dev/null | grep -i node | awk '{print $2}'); do taskkill //F //PID \"$pid\" >/dev/null 2>&1; done",
      "pkill-node": "pkill -9 -f node",
      "killall-node": "killall node",
      "tskill-node": "tskill node",
      "stop-process-node": "Stop-Process -Name node*",
      "wmic-node-delete": "wmic process where name='node.exe' delete",
      "powershell-get-process-stop": "Get-Process node | Stop-Process",
    }
  }

  it("blocks taskkill by image name regardless of slash style", () => {
    expect(detectSelfTerminatingCommand("taskkill /F /IM node.exe /T")).toBeDefined()
    expect(detectSelfTerminatingCommand("taskkill //F //IM node.exe /T")).toBeDefined()
    expect(detectSelfTerminatingCommand("taskkill /IM node.exe")).toBeDefined()
    expect(detectSelfTerminatingCommand("taskkill /F /IM node.exe 2>/dev/null; echo killed")).toBeDefined()
  })

  it("blocks taskkill on the bun image too", () => {
    expect(detectSelfTerminatingCommand("taskkill /F /IM bun.exe")).toBeDefined()
  })

  it("blocks taskkill wrapped in cmd /c", () => {
    expect(detectSelfTerminatingCommand('cd /c && cmd //c "taskkill /F /IM node.exe /T" 2>&1 | tail -5')).toBeDefined()
  })

  it("blocks a while-read PID loop over node", () => {
    const command =
      "tasklist 2>/dev/null | grep -i node | awk '{print $2}' | while read pid; do taskkill //F //PID \"$pid\" >/dev/null 2>&1; done"
    expect(detectSelfTerminatingCommand(command)).toBeDefined()
  })

  it("allows targeted taskkill by PID without a node image", () => {
    expect(detectSelfTerminatingCommand("taskkill /F /PID 1234 /T")).toBeUndefined()
  })

  it("allows ordinary dev commands", () => {
    const safe = [
      "npm run dev -- --host 127.0.0.1 --port 5173",
      "curl -s -o /dev/null -w \"5173: %{http_code}\\n\" http://127.0.0.1:5173/",
      "netstat -ano | findstr :5173",
      "git log --oneline -5",
      "rm -rf node_modules/.vite",
      "tasklist 2>/dev/null | grep -i node | head -5",
      "grep -rn taskkill packages --include=\"*.ts\"",
      "npx serve dist -s -p 5199 &",
      "ps aux | grep -i node",
    ]
    for (const command of safe) {
      expect(detectSelfTerminatingCommand(command)).toBeUndefined()
    }
  })

  it("allows listing node processes without a kill", () => {
    const command = 'tasklist 2>/dev/null | grep -i "node" | head -5; echo "---"; curl -s -o /dev/null -w "5173: %{http_code}\\n" --max-time 3 http://127.0.0.1:5173/'
    expect(detectSelfTerminatingCommand(command)).toBeUndefined()
  })

  it("blocks taskkill with quotes around the image name", () => {
    expect(detectSelfTerminatingCommand('taskkill /F /IM "node.exe" /T')).toBeDefined()
  })
})
