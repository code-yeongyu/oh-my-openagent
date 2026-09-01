import { spawn } from "node:child_process"
import { once } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { RpcProcessRunner } from "../../rpc-process"
import { type ConsoleAttachment, consoleAttachment, mainWindowHandle } from "./windows-console-inspection"
import {
  credentialDigests,
  isAlive,
  type ParentReady,
  type ProbeCase,
  type ProbeMode,
  waitForFile,
} from "./windows-console-probe-state"
import { createWindowsModelAdmissionProbe } from "./windows-console-model-admission"

const PROBE_STEP_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 15_000
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const FAKE_CHILD_PATH = fileURLToPath(new URL("./fake-child.mjs", import.meta.url))
const CONSOLE_HOST_PATH = fileURLToPath(new URL("./windows-console-host.ps1", import.meta.url))
const CREDENTIAL_FILES = ["auth.json", "models.json", "settings.json", "trust.json"] as const

async function detachCurrentConsole(): Promise<void> {
  const { dlopen, FFIType } = await import("bun:ffi")
  const kernel32 = dlopen("kernel32.dll", {
    FreeConsole: {
      args: [],
      returns: FFIType.bool,
    },
  })
  try {
    if (!kernel32.symbols.FreeConsole()) {
      throw new Error("FreeConsole failed for the Windows probe parent")
    }
  } finally {
    kernel32.close()
  }
}

async function runCase(mode: ProbeMode, root: string): Promise<ProbeCase> {
  const readyPath = join(root, `${mode}-ready.json`)
  const stopPath = join(root, `${mode}-stop`)
  const errorPath = join(root, `${mode}-error.txt`)
  const ready = waitForFile(readyPath, AbortSignal.timeout(PROBE_STEP_TIMEOUT_MS))
  const parent = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", CONSOLE_HOST_PATH],
    {
      env: {
        ...process.env,
        OMO_PROBE_BUN: process.execPath,
        OMO_PROBE_SCRIPT: SCRIPT_PATH,
        OMO_PROBE_MODE: mode,
        OMO_PROBE_ROOT: root,
        OMO_PROBE_READY_FILE: readyPath,
        OMO_PROBE_STOP_FILE: stopPath,
        OMO_PROBE_ERROR_FILE: errorPath,
        SENPI_CODING_AGENT_DIR: join(root, "agent"),
        SENPI_CODING_AGENT_SESSION_DIR: join(root, "parent-session"),
      },
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    },
  )
  const closed = once(parent, "close", { signal: AbortSignal.timeout(PROBE_STEP_TIMEOUT_MS) })

  let readyPayload: ParentReady | undefined
  let handle = 0
  let attachment: ConsoleAttachment | undefined
  let code: unknown
  try {
    const outcome = await Promise.race([
      ready.then(() => ({ kind: "ready" as const })),
      closed.then(([exitCode]) => ({ kind: "closed" as const, exitCode })),
    ])
    if (outcome.kind === "closed") {
      const detail = existsSync(errorPath) ? readFileSync(errorPath, "utf8").trim() : "no error detail"
      throw new Error(`console host exited ${String(outcome.exitCode)} before ready: ${detail}`)
    }
    readyPayload = JSON.parse(readFileSync(readyPath, "utf8")) as ParentReady
    handle = mainWindowHandle(readyPayload.pid)
    attachment = consoleAttachment(readyPayload.pid)
  } finally {
    writeFileSync(stopPath, "stop\n")
    ;[code] = await closed
  }

  if (readyPayload === undefined || attachment === undefined) {
    throw new Error("probe parent did not produce its ready payload")
  }
  const parentExitCode = typeof code === "number" ? code : -1
  if (parentExitCode !== 0) {
    const detail = existsSync(errorPath) ? readFileSync(errorPath, "utf8").trim() : "no error detail"
    throw new Error(`probe parent exited ${parentExitCode}: ${detail}`)
  }

  return {
    ...readyPayload,
    consoleAttached: attachment.attached,
    consoleAttachError: attachment.errorCode,
    consoleWindowHandle: attachment.windowHandle,
    consoleWindowVisible: attachment.windowVisible,
    mainWindowHandle: handle,
    expectedVisible: mode === "visible-control",
    childExited: !isAlive(readyPayload.pid),
    parentExitCode,
  }
}

async function runParent(mode: ProbeMode, root: string): Promise<void> {
  const readyPath = process.env.OMO_PROBE_READY_FILE
  const stopPath = process.env.OMO_PROBE_STOP_FILE
  if (readyPath === undefined || stopPath === undefined) {
    throw new Error("console probe parent requires ready and stop file paths")
  }
  await detachCurrentConsole()
  const stop = waitForFile(stopPath, AbortSignal.timeout(30_000))
  const catalogProbe = createWindowsModelAdmissionProbe({
    mode,
    root,
    waitForFile,
    mainWindowHandle,
  })
  const runner = new RpcProcessRunner({
    modelAdmission: catalogProbe.modelAdmission,
    buildSpawn: (spec) => ({
      command: process.execPath,
      args: [FAKE_CHILD_PATH],
      cwd: spec.cwd,
      env: {
        ...process.env,
        SENPI_CODING_AGENT_DIR: join(root, "agent"),
        SENPI_CODING_AGENT_SESSION_DIR: join(root, "child-session"),
      },
    }),
    ...(mode === "visible-control"
      ? {
          spawnProcess: (command, args, options) =>
            spawn(command, [...args], {
              ...options,
              windowsHide: false,
            }),
        }
      : {}),
  })
  const handle = await runner.start({
    task_id: `st_windows_probe_${mode}`,
    cwd: root,
    state_dir: join(root, "state"),
    prompt: "hold",
    model: "omo-mock/mock-1",
  })
  const catalog = await catalogProbe.inspection

  try {
    await handle.steer("stdio-round-trip")
    writeFileSync(
      readyPath,
      `${JSON.stringify({
        pid: handle.pid,
        catalogPid: catalog.pid,
        catalogMainWindowHandle: catalog.mainWindowHandle,
        catalogChildExited: !isAlive(catalog.pid),
        stdioRoundTrip: true,
        mode,
        parentConsoleDetached: true,
      })}\n`,
    )
    await stop
  } finally {
    await handle.terminate({ sigkillDelayMs: 500 })
    await handle.waitForExit()
  }
}

async function runProbe(): Promise<void> {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ result: "SKIP", reason: "windows-only", platform: process.platform }))
    return
  }

  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-rpc-window-probe-")))
  mkdirSync(join(root, "agent"), { recursive: true })
  const credentialsBefore = credentialDigests(CREDENTIAL_FILES)
  let probeResult: {
    readonly pass: boolean
    readonly visible: ProbeCase
    readonly hidden: ProbeCase
    readonly credentialsUntouched: boolean
  } | undefined
  try {
    const visible = await runCase("visible-control", root)
    const hidden = await runCase("hidden-fixed", root)
    const credentialsAfter = credentialDigests(CREDENTIAL_FILES)
    const credentialsUntouched = JSON.stringify(credentialsBefore) === JSON.stringify(credentialsAfter)
    const pass =
      visible.consoleAttached &&
      visible.consoleWindowHandle !== 0 &&
      visible.consoleWindowVisible &&
      !hidden.consoleWindowVisible &&
      hidden.mainWindowHandle === 0 &&
      visible.catalogMainWindowHandle === 0 &&
      hidden.catalogMainWindowHandle === 0 &&
      visible.catalogChildExited &&
      hidden.catalogChildExited &&
      visible.stdioRoundTrip &&
      hidden.stdioRoundTrip &&
      visible.childExited &&
      hidden.childExited &&
      credentialsUntouched

    probeResult = { pass, visible, hidden, credentialsUntouched }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  if (probeResult === undefined) throw new Error("Windows console probe did not produce a result")
  const tempRootRemoved = !existsSync(root)
  console.log(
    JSON.stringify({
      result: probeResult.pass && tempRootRemoved ? "PASS" : "FAIL",
      visible: probeResult.visible,
      hidden: probeResult.hidden,
      isolation: {
        sandboxAgentDir: join(root, "agent"),
        callerAgentDirIgnored: true,
        credentialsUntouched: probeResult.credentialsUntouched,
        credentialFiles: CREDENTIAL_FILES,
      },
      cleanup: {
        visibleCatalogChildExited: probeResult.visible.catalogChildExited,
        hiddenCatalogChildExited: probeResult.hidden.catalogChildExited,
        visibleChildExited: probeResult.visible.childExited,
        hiddenChildExited: probeResult.hidden.childExited,
        tempRootRemoved,
      },
    }),
  )
  if (!probeResult.pass || !tempRootRemoved) process.exitCode = 1
}

const parentIndex = process.argv.indexOf("--parent")
if (parentIndex >= 0) {
  const mode = process.argv[parentIndex + 1]
  const root = process.argv[parentIndex + 2]
  if ((mode !== "visible-control" && mode !== "hidden-fixed") || root === undefined) {
    throw new Error("usage: windows-console-probe.ts --parent <visible-control|hidden-fixed> <root>")
  }
  await runParent(mode, root)
} else {
  await runProbe()
}
