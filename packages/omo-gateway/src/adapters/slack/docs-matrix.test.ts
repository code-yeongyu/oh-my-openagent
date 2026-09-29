import { expect, test } from "bun:test"
import { documentedCapabilities } from "../../adapter/docs-matrix"
import { SLACK_CAPABILITIES } from "./adapter"

test("the Slack rows of the platform matrix equal SLACK_CAPABILITIES for both token profiles", () => {
  expect(documentedCapabilities("Slack (member user token)")).toEqual({ ...SLACK_CAPABILITIES.user })
  expect(documentedCapabilities("Slack (app bot token)")).toEqual({ ...SLACK_CAPABILITIES.bot })
})
