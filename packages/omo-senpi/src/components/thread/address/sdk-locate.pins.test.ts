import { afterEach, expect, test } from "bun:test"

import sdkLocateBase from "./testing/sdk-locate.base.json"
import { sdkOn, type Cleanups } from "./testing/entries"
import { ALIAS, B, createTwoDevices, HERE, KEY, NAMES, T } from "./testing/two-devices"

// The shipped thread SDK's locate (the one omo daemon adopt and a session's eval cell hold) answers exactly what the base
// branch answered, for every principal-free cell: the design lane's condition on T1a, which changes no shipped answer of
// threads.locate while its row stays unresolved. The base answers were captured by these same cells in the base tree.
const ADDRESSES = [
  ...new Set<string>([
    "self",
    "nobody",
    `here/${NAMES.hereLive}`,
    `${B.name}/${NAMES.bLive}`,
    `${B.id}/${T.bLive}`,
    `${B.id.slice(0, 6)}/${T.bLive}`,
    `${HERE.id}/${T.hereLive}`,
    "x/y",
    ...Object.values(T),
    ...Object.values(NAMES),
    ...Object.values(ALIAS),
    ...Object.values(KEY).map(String),
    ...Object.values(T).map((id) => String(id).slice(0, 8)),
  ]),
]
const BASE: Readonly<Record<string, unknown>> = sdkLocateBase.answers
const CELLS = [{}, { prefixTwin: true }].flatMap((setup) =>
  [undefined, true].flatMap((all_scope) =>
    ADDRESSES.map((address) => ({ setup, all_scope, address, key: JSON.stringify([setup, all_scope, address]) })),
  ),
)

const cleanups: Cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

test("#given the table of cells #then it has every captured cell and no other", () => {
  expect(CELLS).toHaveLength(180)
  expect(CELLS.map((cell) => cell.key).toSorted()).toEqual(Object.keys(BASE).toSorted())
})

test.each(CELLS.map((cell) => [cell.key, cell] as const))(
  "#given the cell %s #when the shipped SDK locates it #then it answers the base branch's answer byte for byte",
  async (key, { setup, all_scope, address }) => {
    const td = createTwoDevices({ ...setup, sessionFiles: true })
    cleanups.push(td.cleanup)
    const answer = await sdkOn(td, cleanups).locate({
      thread: address,
      ...(all_scope === undefined ? {} : { all_scope }),
    })
    expect(JSON.parse(JSON.stringify(answer).split(process.cwd()).join("<cwd>"))).toEqual(BASE[key])
  },
)
