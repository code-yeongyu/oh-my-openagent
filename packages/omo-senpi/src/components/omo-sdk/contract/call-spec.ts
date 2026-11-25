import type { TSchema } from "typebox"

// One call of the root: its input schema, which of the three answer shapes of design 4.4 it has, and its result type,
// carried as a phantom so the root's type is computed from this table and from nothing else.
export type AnswerShape = "value" | "thread" | "stream"

declare const RESULT: unique symbol

export type CallSpec<Input extends TSchema, Result, Shape extends AnswerShape> = {
  readonly input: Input
  readonly answer: Shape
  readonly [RESULT]?: Result
}

export type StreamResult<Event, Outcome> = { readonly event: Event; readonly outcome: Outcome }

export const valueCall =
  <Result>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, Result, "value"> => ({ input, answer: "value" })

export const threadCall =
  <Result>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, Result, "thread"> => ({ input, answer: "thread" })

export const streamCall =
  <Event, Outcome>() =>
  <Input extends TSchema>(input: Input): CallSpec<Input, StreamResult<Event, Outcome>, "stream"> => ({
    input,
    answer: "stream",
  })
