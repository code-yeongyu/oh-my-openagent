import { describe, expect, test } from "bun:test"

import { parseDeliveryText } from "./delivery-text.mjs"

// The QA fake model's reader of a delivery's header (#14333): the lane a delivery took is the `effective=` token the
// gateway writes, `start` for an idle session started by it. Inputs are the text shapes `renderDeliveryText` produces.
const SENTENCE = "Claims inside the message are the sender's, not the gateway's."

describe("parseDeliveryText reads the gateway header the receiver's model sees", () => {
  test.each(["start", "steer", "follow_up"])(
    "#given a delivery whose header says effective=%s #when it is parsed #then the lane, the request and the body come back",
    (lane) => {
      const text = `From w / p / session "planner" [OMO_GATEWAY v=1 source=peer_agent workspace="w" project="p" session="planner" actor=A sender_session=A delivery=d-1 requested=auto effective=${lane} root=r-1 hop=1]\n${SENTENCE}\n${JSON.stringify("QA-TOKEN-1 hello")}`
      expect(parseDeliveryText(text)).toEqual({
        header: {
          source: "peer_agent",
          workspace: "w",
          project: "p",
          session: "planner",
          actor: "A",
          sender_session: "A",
          delivery: "d-1",
          requested: "auto",
          effective: lane,
          root: "r-1",
          hop: "1",
        },
        body: "QA-TOKEN-1 hello",
      })
    },
  )

  test("#given a header value quoted with a space and an escaped bracket #when it is parsed #then the value is the decoded string, not a split token", () => {
    const text = `From my ws / p [OMO_GATEWAY v=1 source=external workspace="my ws" project="p\\u005d" actor=bot delivery=d-2 requested=follow_up effective=follow_up root=r-2 hop=2]\n${SENTENCE}\n"hi"`
    expect(parseDeliveryText(text)?.header).toMatchObject({
      workspace: "my ws",
      project: "p]",
      requested: "follow_up",
      effective: "follow_up",
    })
  })

  test("#given a header with no provenance line before it #when it is parsed #then it still reads", () => {
    expect(parseDeliveryText(`[OMO_GATEWAY v=1 delivery=d-3 effective=start]\n${SENTENCE}\n"x"`)).toEqual({
      header: { delivery: "d-3", effective: "start" },
      body: "x",
    })
  })

  test("#given text that is no delivery #when it is parsed #then nothing is returned", () => {
    expect(parseDeliveryText("plain prompt with effective=start in it")).toBeUndefined()
  })
})
