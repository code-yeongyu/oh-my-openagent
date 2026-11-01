// Every provider shape for "this route does not serve the configured model", and failures that must not
// read as one. Same entries as senpi's test/suite/model-not-found-inventory.ts (senpi#4283) so both classify the same answers.

export const MODEL_NOT_FOUND_ANSWERS: readonly (readonly [label: string, message: string])[] = [
  ["OpenAI-compatible model_not_found", '400 {"code":"model_not_found","message":"unknown provider for model faux-1"}'],
  [
    "OpenAI model_not_found for a model the key cannot use",
    '404 {"error":{"message":"The model `faux-1` does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}',
  ],
  ["gateway unknown provider for model", "400 Bad Request: unknown provider for model faux-1"],
  ["model_not_found wrapped in a 503", '503 {"code":"model_not_found","message":"model faux-1 not found"}'],
  ["unknown provider for model wrapped in a 502", "502 Bad Gateway: unknown provider for model faux-1"],
  [
    "OpenAI prose without the code",
    '404 {"error":{"message":"The model `faux-1` does not exist","type":"invalid_request_error","param":null,"code":null}}',
  ],
  [
    "Anthropic not_found_error naming the model",
    '404 {"type":"error","error":{"type":"not_found_error","message":"model: faux-1"},"request_id":"req_fixture01"}',
  ],
  [
    "Google models/<id> is not found",
    '404 {"error":{"code":404,"message":"models/faux-1 is not found for API version v1beta, or is not supported for generateContent.","status":"NOT_FOUND"}}',
  ],
]

export const NOT_MODEL_NOT_FOUND_ANSWERS: readonly (readonly [label: string, message: string])[] = [
  ["401", "401: Unauthorized"],
  ["429 rate limit", "429: rate limited, retry after 3s"],
  ["insufficient_quota", '429 {"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}'],
  ["500 overloaded", '500 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'],
  [
    "Anthropic not_found_error for a file",
    '404 {"type":"error","error":{"type":"not_found_error","message":"File not found: file_fixture01"},"request_id":"req_fixture02"}',
  ],
  ["Google NOT_FOUND for a cached content", '404 {"error":{"code":404,"message":"cachedContents/fixture01 not found","status":"NOT_FOUND"}}'],
  ["a generic 404", "404 Not Found"],
]
