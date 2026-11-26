import type { Static, TSchema } from "typebox"

import type { CallSpec, StreamResult } from "./call-spec"
import type { ROOT_CALLS } from "./calls"
import type { OmoStream, OmoThreadAnswer, OmoValue } from "./failure"

/** What a call that can wait takes (design 4.4); a call whose input already names `deadline_ms` takes the signal only. */
export type CallOptions = { readonly signal?: AbortSignal; readonly deadline_ms?: number }
type OptionsFor<Input> = "deadline_ms" extends keyof Input ? Omit<CallOptions, "deadline_ms"> : CallOptions

// The root's type (first-party design 4.1, 4.2), computed from ROOT_CALLS: each dotted key is one member, its input the
// static type of its schema and its answer one of the three shapes of 4.4. Types only; slice P1b builds the object.
type Calls = typeof ROOT_CALLS
export type RootCallKey = keyof Calls & string

type Answer<Spec> =
  Spec extends CallSpec<TSchema, infer Result, "value", boolean>
    ? Promise<OmoValue<Result>>
    : Spec extends CallSpec<TSchema, infer Result, "thread", boolean>
      ? Promise<OmoThreadAnswer<Result>>
      : Spec extends CallSpec<TSchema, StreamResult<infer Event, infer Outcome>, "stream", boolean>
        ? OmoStream<Event, Outcome>
        : never

type Member<Spec> =
  Spec extends CallSpec<infer Input, unknown, infer _Shape, false>
    ? Partial<Static<Input>> extends Static<Input>
      ? (input?: Static<Input>) => Answer<Spec>
      : (input: Static<Input>) => Answer<Spec>
    : Spec extends CallSpec<infer Input, unknown, infer _Shape, true>
      ? Partial<Static<Input>> extends Static<Input>
        ? (input?: Static<Input>, options?: OptionsFor<Static<Input>>) => Answer<Spec>
        : (input: Static<Input>, options?: OptionsFor<Static<Input>>) => Answer<Spec>
      : never

type Head<Key extends string> = Key extends `${infer First}.${string}` ? First : Key
type Rest<Key extends string, First extends string> = Key extends `${First}.${infer Tail}` ? Tail : never

type Tree<Prefix extends string, Keys extends string> = {
  readonly [First in Head<Keys>]: First extends Keys
    ? Member<Calls[`${Prefix}${First}` & RootCallKey]>
    : Tree<`${Prefix}${First}.`, Rest<Keys, First>>
}

export type OmoSdkRoot = Tree<"", RootCallKey> & {
  /** Aborts account and device requests in flight, as `createOmoSdk().close()` does today. */
  readonly close: () => void
  /** `close()`, then the gateway store and the remote sessions. */
  readonly dispose: () => Promise<void>
}

export type RootCallInput<Key extends RootCallKey> =
  Calls[Key] extends CallSpec<infer Input, unknown, infer _Shape, boolean> ? Static<Input> : never
