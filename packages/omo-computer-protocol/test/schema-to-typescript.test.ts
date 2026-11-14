import { expect, test } from "vitest"

import { typeText } from "../scripts/schema-to-typescript.ts"
import type { ClickParams, MouseDownParams } from "../src/index.ts"

test("members that require each other (dependentRequired) come together or not at all", () => {
  const text = typeText({
    type: "object",
    properties: {
      target: { type: "string" },
      x: { type: ["number", "null"] },
      y: { type: ["number", "null"] },
    },
    required: ["target"],
    dependentRequired: { x: ["y"], y: ["x"] },
  })
  expect(text).toBe("{\n\ttarget: string\n} & ({\n\tx: number\n\ty: number\n} | {\n\tx?: null\n\ty?: null\n})")
})

test("a pair whose members do not allow null renders its absent arm as never", () => {
  const text = typeText({
    type: "object",
    properties: { target: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
    required: ["target"],
    dependentRequired: { x: ["y"], y: ["x"] },
  })
  expect(text).toBe("{\n\ttarget: string\n} & ({\n\tx: number\n\ty: number\n} | {\n\tx?: never\n\ty?: never\n})")
})

test("a one-way dependentRequired is refused, not rendered as independent members", () => {
  expect(() =>
    typeText({
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      dependentRequired: { x: ["y"] },
    }),
  ).toThrow(/dependentRequired/)
})

test("the generated click and mouse.down params refuse a lone coordinate at type level", () => {
  const both: ClickParams = { target: "101", x: 5, y: 6 }
  const neither: MouseDownParams = { target: "101" }
  // @ts-expect-error a lone x is not a ClickParams
  const loneX: ClickParams = { target: "101", x: 5 }
  // @ts-expect-error a lone y is not a MouseDownParams
  const loneY: MouseDownParams = { target: "101", y: 5 }
  // @ts-expect-error a null y beside a given x is not a ClickParams (review L1 of #13140)
  const nullY: ClickParams = { target: "101", x: 5, y: null }
  // @ts-expect-error an explicit null coordinate is not a MouseDownParams: absent means absent
  const nullX: MouseDownParams = { target: "101", x: null }
  expect([both, neither, loneX, loneY, nullY, nullX]).toHaveLength(6)
})
