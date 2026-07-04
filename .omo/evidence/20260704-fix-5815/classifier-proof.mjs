import {
  classifyRuntimeFallbackError,
  isRuntimeFallbackRetryableError,
} from "@oh-my-opencode/model-core"

const retryOnErrors = [429, 500, 502, 503, 504]
const error = { message: "Free usage exceeded, subscribe to Go" }

console.log(JSON.stringify({
  message: error.message,
  type: classifyRuntimeFallbackError(error) ?? null,
  retryable: isRuntimeFallbackRetryableError(error, retryOnErrors),
}, null, 2))
