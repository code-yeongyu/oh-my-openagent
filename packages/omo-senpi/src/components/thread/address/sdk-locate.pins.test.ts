import { expect, test } from "bun:test"

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

test("#given every address form, both scopes and both fixtures #when the shipped SDK locates it #then it answers the base branch's answer byte for byte", async () => {
  const answers: Record<string, unknown> = {}
  for (const setup of [{}, { prefixTwin: true }])
    for (const all_scope of [undefined, true])
      for (const address of ADDRESSES) {
        const cleanups: Cleanups = []
        const td = createTwoDevices({ ...setup, sessionFiles: true })
        cleanups.push(td.cleanup)
        answers[JSON.stringify([setup, all_scope, address])] = await sdkOn(td, cleanups).locate({
          thread: address,
          ...(all_scope === undefined ? {} : { all_scope }),
        })
        for (const cleanup of cleanups.reverse()) await cleanup()
      }
  const written = JSON.parse(JSON.stringify(answers).split(process.cwd()).join("<cwd>")) as Record<string, unknown>
  expect(Object.keys(written)).toHaveLength(180)
  expect(written).toEqual(BASE)
})
