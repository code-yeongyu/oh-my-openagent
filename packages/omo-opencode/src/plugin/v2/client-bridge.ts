import { isRecord } from "@oh-my-opencode/utils"

/**
 * Structural surface of the v2 generated client that the bridge touches.
 * Kept local on purpose: the real types live behind @opencode-ai/client,
 * which this module must not import (adapter stays free of beta deps).
 */
export interface V2PluginClientSurface {
  agent: { list: (input?: unknown) => Promise<unknown> }
  config: { get: (input?: unknown) => Promise<unknown> }
  model: { list: (input?: unknown) => Promise<unknown> }
  session: {
    interrupt: (input: unknown) => Promise<unknown>
    create: (input: unknown) => Promise<unknown>
    get: (input: unknown) => Promise<unknown>
    context: (input: unknown) => Promise<unknown>
    prompt: (input: unknown) => Promise<unknown>
    active: (input?: unknown) => Promise<unknown>
  }
}

export interface V2BridgeEnvelope {
  data?: unknown
  error?: unknown
}

export interface V2ClientBridge {
  app: { agents: () => Promise<V2BridgeEnvelope> }
  config: { get: () => Promise<V2BridgeEnvelope> }
  model: { list: () => Promise<V2BridgeEnvelope> }
  session: {
    abort: (input: unknown) => Promise<V2BridgeEnvelope>
    create: (input: unknown) => Promise<V2BridgeEnvelope>
    get: (input: unknown) => Promise<V2BridgeEnvelope>
    messages: (input: unknown) => Promise<V2BridgeEnvelope>
    prompt: (input: unknown) => Promise<V2BridgeEnvelope>
    promptAsync: (input: unknown) => Promise<V2BridgeEnvelope>
    status: () => Promise<V2BridgeEnvelope>
  }
}

/**
 * v1 SDK clients resolve to hey-api style envelopes ({data} | {error}) while
 * the v2 client returns raw outputs and rejects on failure. Every bridged
 * call therefore never rejects: failures land in the error field exactly
 * where existing omo consumers expect them (SP4 alignment table).
 */
async function envelope(call: () => Promise<unknown>): Promise<V2BridgeEnvelope> {
  try {
    return { data: await call() }
  } catch (error) {
    return { error }
  }
}

function readSessionID(input: unknown): string {
  if (!isRecord(input)) return ""
  const path = input.path
  if (isRecord(path) && typeof path.id === "string") return path.id
  if (typeof input.sessionID === "string") return input.sessionID
  const body = input.body
  if (isRecord(body)) {
    if (typeof body.sessionID === "string") return body.sessionID
    const inner = body.path
    if (isRecord(inner) && typeof inner.id === "string") return inner.id
  }
  return ""
}

function readBody(input: unknown): Record<string, unknown> {
  if (isRecord(input) && isRecord(input.body)) return input.body
  return {}
}

function normalizePromptInput(input: unknown): Record<string, unknown> {
  return { sessionID: readSessionID(input), ...readBody(input) }
}

/**
 * Adapts ctx.plugin (the full v2 generated client) onto the method surface
 * omo consumers already call: abort->interrupt, messages->context,
 * status->active, prompt/promptAsync both ride the queued v2 prompt channel.
 */
export function createV2ClientBridge(pluginClient: V2PluginClientSurface): V2ClientBridge {
  return {
    app: {
      agents: () => envelope(() => pluginClient.agent.list()),
    },
    config: {
      get: () => envelope(() => pluginClient.config.get()),
    },
    model: {
      list: () => envelope(() => pluginClient.model.list()),
    },
    session: {
      abort: (input) => envelope(() => pluginClient.session.interrupt({ sessionID: readSessionID(input) })),
      create: (input) => envelope(() => pluginClient.session.create(readBody(input))),
      get: (input) => envelope(() => pluginClient.session.get({ sessionID: readSessionID(input) })),
      messages: (input) => envelope(() => pluginClient.session.context({ sessionID: readSessionID(input) })),
      prompt: (input) => envelope(() => pluginClient.session.prompt(normalizePromptInput(input))),
      promptAsync: (input) => envelope(() => pluginClient.session.prompt(normalizePromptInput(input))),
      status: () => envelope(() => pluginClient.session.active()),
    },
  }
}
