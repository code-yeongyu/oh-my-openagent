import fs from "node:fs"

export function completedUsage() {
  return {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  }
}

export function sendSse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.write("data: [DONE]\n\n")
  res.end()
}

export function textEvents(callCount, text) {
  const id = `resp_${callCount}`
  const item = `msg_${callCount}`
  return [
    {
      type: "response.created",
      response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: item },
    },
    {
      type: "response.output_text.delta",
      item_id: item,
      output_index: 0,
      delta: text,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: item },
    },
    {
      type: "response.completed",
      response: { usage: completedUsage() },
    },
  ]
}

export function toolCallEvents(callCount, name, callId, argsObj) {
  const id = `resp_${callCount}`
  const fcId = `fc_${callCount}`
  const argsStr = JSON.stringify(argsObj)
  return [
    {
      type: "response.created",
      response: { id, created_at: Math.floor(Date.now() / 1000), model: "gpt-fake" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: fcId,
        call_id: callId,
        name,
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: fcId,
      output_index: 0,
      delta: argsStr,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: fcId,
        call_id: callId,
        name,
        arguments: argsStr,
        status: "completed",
      },
    },
    {
      type: "response.completed",
      response: { usage: completedUsage() },
    },
  ]
}

export function appendLog(logFile, line) {
  try {
    fs.appendFileSync(logFile, line)
  } catch {
  }
}
