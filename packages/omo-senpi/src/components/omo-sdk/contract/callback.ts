import { type TSchema, Type } from "typebox"

/**
 * A function the caller passes (a sign-in's code handler, a setup's per-stage decision): typed by its arguments' and
 * answer's shapes, which the registry row carries as `x-callback` (sync-inputs copies them), so a callback field is never
 * an untyped `{}`. Any function is accepted at the boundary; the shapes are the contract its caller codes against.
 */
export const callback = <Fn>(shape: { readonly args: readonly TSchema[]; readonly answer: TSchema }) =>
  Type.Unsafe<Fn>({ "x-callback": { args: shape.args, answer: shape.answer } })

/** A callback's answer when it returns nothing the core reads (it may return a promise of nothing). */
export const Nothing = Type.Unsafe<void | Promise<void>>({ "x-nothing": true })
