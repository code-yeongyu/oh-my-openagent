export type Verdict = "CONFIRMS" | "CONTRADICTS" | "UNMEASURED"
export type FinalVerdict = Verdict | "FLAKY"

export type Reading = { readonly verdict: Verdict; readonly observed: string }

type Question = { readonly id: QuestionId; readonly question: string; readonly condition: string }

export type QuestionId =
  "uinput-module" | "uinput-writable" | "xorg-dummy" | "libinput-hotplug" | "xi-version" | "xi-raw-delivery"

export const QUESTIONS: readonly Question[] = [
  {
    id: "uinput-module",
    question: "Is /dev/uinput present after loading the uinput module?",
    condition: "sudo -n modprobe uinput",
  },
  {
    id: "uinput-writable",
    question: "Can the job's own user open /dev/uinput for writing?",
    condition: "after sudo -n setfacl -m u:<user>:rw /dev/uinput; open(O_WRONLY|O_NONBLOCK) by the job user",
  },
  {
    id: "xorg-dummy",
    question: "Does real Xorg start with the dummy video driver and answer a client?",
    condition: "Xorg run directly on the runner (sudo), -config with Driver dummy, free display, xdpyinfo within 15 s",
  },
  {
    id: "libinput-hotplug",
    question: "Does Xorg add a new uinput keyboard through libinput?",
    condition: "uinput keyboard created after Xorg is up; xinput list and the server log within 5 s",
  },
  {
    id: "xi-version",
    question: "Does the server speak XInput 2.1 or later?",
    condition: "xinput --version, 'XI version on server'",
  },
  {
    id: "xi-raw-delivery",
    question: "Does a key sent through the virtual keyboard arrive as an XI2 RawKeyPress from that device?",
    condition: "xinput test-xi2 --root reading; KEY_F13 press and release sent through uinput, up to 10 sends",
  },
]

/** The server's XI version from `xinput --version`, or null when that line is absent. */
export function parseXiServerVersion(out: string): { readonly major: number; readonly minor: number } | null {
  const m = /^XI version on server:\s*(\d+)\.(\d+)/m.exec(out)
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null
}

export function xiAtLeast21(v: { readonly major: number; readonly minor: number }): boolean {
  return v.major > 2 || (v.major === 2 && v.minor >= 1)
}

/** True when `xinput test-xi2` output holds a RawKeyPress from `deviceId` (device or source), with detail `keycode` unless null. */
export function hasRawKeyPress(out: string, deviceId: number, keycode: number | null): boolean {
  return out.split(/^(?=EVENT type )/m).some((block) => {
    if (!/^EVENT type 13 \(RawKeyPress\)/.test(block)) return false
    const dev = /^\s*device:\s*(\d+)\s*\((\d+)\)/m.exec(block)
    const det = /^\s*detail:\s*(\d+)/m.exec(block)
    if (!dev || !det) return false
    return [Number(dev[1]), Number(dev[2])].includes(deviceId) && (keycode === null || Number(det[1]) === keycode)
  })
}

export function combine(readings: readonly Reading[]): { readonly verdict: FinalVerdict; readonly agree: string } {
  const [first] = readings
  if (!first) return { verdict: "UNMEASURED", agree: "0/0" }
  const same = readings.filter((r) => r.verdict === first.verdict).length
  return { verdict: same === readings.length ? first.verdict : "FLAKY", agree: `${same}/${readings.length}` }
}

export type LedgerRow = Question & {
  readonly verdict: FinalVerdict
  readonly runs: string
  readonly rerun: string
  readonly observed: string
  readonly hostBuild: string
}

const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim() || "-"

export function ledgerTsv(rows: readonly LedgerRow[]): string {
  const header = "id\tquestion\tcondition\tverdict\truns\trerun\tobserved\thost_build"
  const lines = rows.map((r) =>
    [r.id, r.question, r.condition, r.verdict, r.runs, r.rerun, r.observed, r.hostBuild].map(cell).join("\t"),
  )
  return `${[header, ...lines].join("\n")}\n`
}

/** The lines the workflow reads: the two facts the row's acceptance names, then one verdict line. */
export function summaryLines(rows: readonly LedgerRow[]): readonly string[] {
  const ok = (id: QuestionId) => rows.find((r) => r.id === id)?.verdict === "CONFIRMS"
  const failed = rows.find((r) => r.verdict !== "CONFIRMS")
  return [
    ok("uinput-writable") ? "uinput=writable" : "uinput=not-writable",
    ok("xi-version") && ok("xi-raw-delivery") ? "xi_raw=2.1+" : "xi_raw=absent",
    failed
      ? `PROBE xorg-uinput verdict=fail: hosted runner cannot carry ${failed.id} (${failed.verdict})`
      : `PROBE xorg-uinput verdict=pass rows=${rows.length}`,
  ]
}
