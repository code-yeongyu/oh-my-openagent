import { describe, expect, it } from "bun:test"

import {
  DEFAULT_POSTHOG_API_KEY,
  DEFAULT_POSTHOG_HOST,
  createTelemetryClient,
  getTelemetryDistinctId,
  type TelemetryCaptureMessage,
} from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import {
  SENPI_MACHINE_ID_PREFIX,
  SENPI_TELEMETRY_EVENT_NAME,
  createSenpiTelemetryComponent,
  createSenpiTelemetryProductConfig,
} from "./index"
import {
  FIXED_NOW,
  createEnabledEnv,
  createHangingTransportRecorder,
  createOsProvider,
  createRejectingTransportRecorder,
  createSilentLogger,
  createTransportRecorder,
  withTempAgentDir,
} from "./telemetry.test-support"

describe("omo-senpi telemetry payloads", () => {
  it("#given telemetry component and telemetry-core builder #when session_start captures through injected transport #then payload equivalence holds", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const componentTransport = createTransportRecorder()
      const coreTransport = createTransportRecorder()
      const env = createEnabledEnv(agentDir)
      const osProvider = createOsProvider("senpi-payload-host")
      const expectedDistinctId = getTelemetryDistinctId(SENPI_MACHINE_ID_PREFIX, osProvider)
      createSenpiTelemetryComponent({
        env,
        now: FIXED_NOW,
        osProvider,
        timeoutMs: 50,
        transportFactory: componentTransport.factory,
      }).register(pi, { config: pi, logger: createSilentLogger() })
      const coreClient = createTelemetryClient({
        env,
        osProvider,
        product: createSenpiTelemetryProductConfig(),
        source: "senpi-extension",
        transportFactory: coreTransport.factory,
      })

      // when
      await pi.dispatch("session_start", {})
      coreClient.trackActive({
        dayUTC: "2026-07-03",
        distinctId: expectedDistinctId,
        reason: "session_start",
      })
      await coreClient.flush()
      await coreClient.shutdown()

      // then
      expect(createSenpiTelemetryProductConfig()).toMatchObject({
        defaultApiKey: DEFAULT_POSTHOG_API_KEY,
        defaultHost: DEFAULT_POSTHOG_HOST,
        eventName: SENPI_TELEMETRY_EVENT_NAME,
        machineIdPrefix: SENPI_MACHINE_ID_PREFIX,
        packageName: "@oh-my-opencode/omo-senpi",
        platform: "omo-senpi",
        productEnvPrefix: "OMO_SENPI",
        productName: "omo-senpi",
      })
      expect(componentTransport.messages).toEqual(coreTransport.messages)
    })
  })

  it("#given missing env and empty session payload #when session_start fires #then defaults are safe and no exception escapes", async () => {
    await withTempAgentDir(async (stateDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const messages: TelemetryCaptureMessage[] = []

      // when
      createSenpiTelemetryComponent({
        env: { POSTHOG_API_KEY: "test-api-key" },
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-empty-input-host"),
        stateDir,
        timeoutMs: 50,
        transportFactory: createRejectingTransportRecorder(messages),
      }).register(pi, { config: pi, logger: createSilentLogger() })
      await pi.dispatch("session_start", {})

      // then
      expect(messages).toHaveLength(1)
    })
  })

  it("#given a hanging transport #when session_start fires #then send failure does not block the session_start path", async () => {
    await withTempAgentDir(async (agentDir) => {
      // given
      const pi = new FakeExtensionAPI()
      const messages: TelemetryCaptureMessage[] = []
      createSenpiTelemetryComponent({
        env: createEnabledEnv(agentDir),
        now: FIXED_NOW,
        osProvider: createOsProvider("senpi-hanging-host"),
        timeoutMs: 1,
        transportFactory: createHangingTransportRecorder(messages),
      }).register(pi, { config: pi, logger: createSilentLogger() })

      // when
      await pi.dispatch("session_start", {})

      // then
      expect(messages).toHaveLength(1)
    })
  })
})
