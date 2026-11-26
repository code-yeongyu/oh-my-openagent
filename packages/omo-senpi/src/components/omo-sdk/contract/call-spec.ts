import type { TSchema } from "typebox"

// One call of the root: its input schema, which of the three answer shapes of design 4.4 it has, and its result type,
// carried as a phantom so the root's type is computed from this table and from nothing else.
export type AnswerShape = "value" | "thread" | "stream"

declare const RESULT: unique symbol

/** `waits`: the call waits on a host, the relay, the account service, a process or the clock, so it takes CallOptions. */
export type CallSpec<Input extends TSchema, Result, Shape extends AnswerShape, Waits extends boolean = boolean> = {
  readonly input: Input
  readonly answer: Shape
  readonly waits: Waits
  readonly [RESULT]?: Result
}

// Design 4.4: an input outside the call's schema answers invalid_arguments, an unknown key included. The thread tools'
// own parameter schemas are open objects, so every root input is closed here, at the one place a call is declared: the
// top-level object, or each object form of a union. The static type is the schema's own; only validation narrows.
type Node = { readonly type?: unknown; readonly anyOf?: readonly Node[]; readonly additionalProperties?: unknown }
const closeNode = (node: Node): Node =>
  node.anyOf !== undefined
    ? { ...node, anyOf: node.anyOf.map(closeNode) }
    : node.type === "object" && node.additionalProperties === undefined
      ? { ...node, additionalProperties: false }
      : node
const closed = <Input extends TSchema>(input: Input): Input => closeNode(input as Node) as Input

export type StreamResult<Event, Outcome> = { readonly event: Event; readonly outcome: Outcome }

export const valueCall =
  <Result>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, Result, "value", true> => ({
    input: closed(input),
    answer: "value",
    waits: true,
  })

/** A value call that answers at once from this process and takes no wait options. */
export const instantCall =
  <Result>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, Result, "value", false> => ({
    input: closed(input),
    answer: "value",
    waits: false,
  })

export const threadCall =
  <Result>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, Result, "thread", true> => ({
    input: closed(input),
    answer: "thread",
    waits: true,
  })

export const streamCall =
  <Event, Outcome>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, StreamResult<Event, Outcome>, "stream", true> => ({
    input: closed(input),
    answer: "stream",
    waits: true,
  })
