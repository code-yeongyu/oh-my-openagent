import { malformed } from "./errors"
import type { Element } from "./facade"
import type { Link } from "./link"
import type {
  ActionOptions,
  ActionReport,
  AxNode,
  AxSnapshot,
  AxSnapshotOptions,
  Ref,
  TargetId,
  TypeReport,
} from "./types"
import { isRecord, parseAttributes, parseAxNode, parseAxSnapshot } from "./validate"

const deliveryOptions = (options: ActionOptions | undefined): object =>
  options?.delivery === undefined ? {} : { opts: { deliveryMode: options.delivery } }

export class AxElement implements Element {
  readonly ref: Ref
  readonly node: AxNode | null
  readonly #link: Link
  readonly #window: TargetId

  constructor(link: Link, window: TargetId, ref: Ref, node: AxNode | null) {
    this.#link = link
    this.#window = window
    this.ref = ref
    this.node = node
  }

  read(): Promise<AxNode> {
    return this.#link.read("ax.node", { ref: this.ref }, parseAxNode)
  }

  press(options?: ActionOptions): Promise<ActionReport> {
    return this.#link.act("ax.perform", { ref: this.ref, action: "press" }, options?.verify)
  }

  click(options?: ActionOptions): Promise<ActionReport> {
    return this.#link.act("ax.click", { ref: this.ref, ...deliveryOptions(options) }, options?.verify)
  }

  setValue(value: string, options?: ActionOptions): Promise<ActionReport> {
    return this.#link.act("ax.setValue", { ref: this.ref, value }, options?.verify)
  }

  async type(text: string, options?: ActionOptions): Promise<TypeReport> {
    const reply = await this.#link.exec("ax.typeText", { ref: this.ref, text, ...deliveryOptions(options) })
    if (!isRecord(reply) || (reply.method !== "inserted" && reply.method !== "keys")) {
      throw malformed("ax.typeText", "exec", reply)
    }
    const report: TypeReport = { ...this.#link.report("ax.typeText", reply.report), input: reply.method }
    return this.#link.verifyAfter(report, options?.verify)
  }

  focus(options?: ActionOptions): Promise<ActionReport> {
    return this.#link.act("ax.focus", { ref: this.ref }, options?.verify)
  }

  perform(action: string, options?: ActionOptions): Promise<ActionReport> {
    return this.#link.act("ax.perform", { ref: this.ref, action }, options?.verify)
  }

  attributes(): Promise<Readonly<Record<string, string>>> {
    return this.#link.read("ax.attributes", { ref: this.ref }, parseAttributes)
  }

  drill(options?: AxSnapshotOptions): Promise<AxSnapshot> {
    const params = { target: this.#window, opts: { ...options, root: this.ref } }
    return this.#link.read("ax.snapshot", params, (value) => parseAxSnapshot(value))
  }
}
