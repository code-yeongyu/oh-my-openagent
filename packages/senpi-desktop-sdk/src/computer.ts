import type { AuditEvent, DesktopCapabilities, EpochChanged } from "@oh-my-opencode/senpi-desktop-protocol"
import { auditEvents } from "./audit"
import { runBatch } from "./batch"
import { type ConfirmControl, ForegroundControl } from "./control"
import { epochEvents, stopPath } from "./epoch"
import { refusal } from "./errors"
import type { BatchOptions, BatchReport, Computer, Control, Events, Step, StopPath, Target, Window } from "./facade"
import type { Link } from "./link"
import { matchesSelector } from "./select"
import { CaptureTarget } from "./target"
import type { Display, Expectation, Verdict, VerifyOptions, WindowFilter, WindowSelector, WindowSummary } from "./types"
import { parseCapabilities, parseDisplay, parseList, parseWindow } from "./validate"
import { verify } from "./verify"
import { DesktopWindow } from "./window"

export class LinkedComputer implements Computer {
  readonly desktop: Target
  readonly control: Control
  readonly stop: StopPath
  readonly audit: Events<AuditEvent>
  readonly epoch: Events<EpochChanged>
  readonly #link: Link

  constructor(link: Link, confirmControl: ConfirmControl | undefined) {
    this.#link = link
    this.desktop = new CaptureTarget(link, "desktop", "desktop")
    this.control = new ForegroundControl(link, confirmControl)
    this.stop = stopPath(link)
    this.audit = auditEvents(link)
    this.epoch = epochEvents(link)
  }

  capabilities(): Promise<DesktopCapabilities> {
    return this.#link.read("capabilities", {}, parseCapabilities)
  }

  displays(): Promise<readonly Display[]> {
    return this.#link.read("displays", {}, (value) => parseList(value, parseDisplay))
  }

  async windows(filter?: WindowFilter): Promise<readonly Window[]> {
    return (await this.#matching(filter)).map((summary) => new DesktopWindow(this.#link, summary))
  }

  async window(selector: WindowSelector): Promise<Window> {
    const found = await this.#matching(selector)
    const [only] = found
    if (only === undefined) {
      throw refusal("WindowNotFound", `no window matches ${JSON.stringify(selector)}`, "no_match")
    }
    if (found.length > 1) {
      throw refusal("InvalidTarget", `${found.length} windows match ${JSON.stringify(selector)}`, "ambiguous", {
        candidates: found,
      })
    }
    return new DesktopWindow(this.#link, only)
  }

  verify(expectation: Expectation, options?: VerifyOptions): Promise<Verdict> {
    return verify(this.#link, expectation, options)
  }

  batch(steps: readonly Step[], options?: BatchOptions): Promise<BatchReport> {
    return runBatch(this, steps, options)
  }

  async close(): Promise<void> {
    this.#link.close()
  }

  async #matching(selector: WindowSelector | undefined): Promise<readonly WindowSummary[]> {
    const windows = await this.#link.read("windows", {}, (value) => parseList(value, parseWindow))
    return windows.filter((window) => matchesSelector(window, selector))
  }
}
