# Manual Testing Guide for Tool Call Middleware

This guide provides step-by-step instructions for manually testing each tool call protocol format supported by the middleware.

## Prerequisites

### Required Configuration

Your `~/.senpi/agent/models.json` must include the following provider configurations:

```json
{
   "providers": {
      "openrouter-qwen": {
         "baseUrl": "https://openrouter.ai/api/v1",
         "api": "openai-completions",
         "apiKey": "sk-or-v1-...",
         "models": [
            {
               "id": "qwen/qwen3.5-27b",
               "name": "Qwen 3.5 27B Hermes (OpenRouter)",
               "compat": {
                  "toolCallFormat": "hermes"
               }
            }
         ]
      },
      "openrouter-gemma": {
         "baseUrl": "https://openrouter.ai/api/v1",
         "api": "openai-completions",
         "apiKey": "sk-or-v1-...",
         "models": [
            {
               "id": "google/gemma-4-31b-it",
               "name": "Gemma 4 31B Venice BF16 (OpenRouter)",
               "compat": {
                  "toolCallFormat": "gemma4-delimiter"
               }
            }
         ]
      },
      "openrouter-gemini": {
         "baseUrl": "https://openrouter.ai/api/v1",
         "api": "openai-completions",
         "apiKey": "sk-or-v1-...",
         "models": [
            {
               "id": "google/gemini-3-flash-preview",
               "name": "Gemini 3 Flash Preview (OpenRouter)",
               "compat": {
                  "toolCallFormat": "xml"
               }
            }
         ]
      }
   }
}
```

## Protocol Test Commands

### 1. Hermes Protocol (Qwen Models)

The Hermes format uses `<tool_call>` XML tags containing JSON tool call definitions.

**Test Command:**
```bash
senpi --provider openrouter-qwen --model "qwen/qwen3.5-27b" -p "Read the contents of package.json and tell me the project name"
```

**Expected Behavior:**
- The model should emit a tool call wrapped in `<tool_call>` tags
- The tool call should contain valid JSON with `name` and `arguments` fields
- Example output format from model:
  ```xml
  <tool_call>
  {"name": "read", "arguments": {"filePath": "package.json"}}
  </tool_call>
  ```
- After tool execution, the model should receive the result and respond with the project name

**Protocol Format Details:**
- Tool definitions are rendered as JSON inside `<tools></tools>` XML tags in the system prompt
- Tool calls use `<tool_call>\n{...}\n</tool_call>` format
- Tool responses use `<tool_response>{"name":"...","content":"..."}</tool_response>` format

---

### 2. MorphXml Protocol (Gemini Models)

The MorphXml format uses XML-style function calls with parameters as child elements.

**Test Command:**
```bash
senpi --provider openrouter-gemini --model "google/gemini-3-flash-preview" -p "List all TypeScript files in src/ using the find tool"
```

**Expected Behavior:**
- The model should emit an XML-style tool call with the function name as the root element
- Parameters should appear as child elements with proper indentation
- Example output format from model:
  ```xml
  <find>
     <pattern>*.ts</pattern>
     <path>src</path>
  </find>
  ```
- The middleware parses this XML and converts it to a standard tool call

**Protocol Format Details:**
- Tools are described in the system prompt with XML formatting rules
- Function calls use `<function_name><param>value</param></function_name>` syntax
- Multi-line string values are supported within element content
- Tool responses are wrapped in `<tool_response><tool_name>...</tool_name><result>...</result></tool_response>`

---

### 3. Gemma4-Delimiter Protocol (Gemma Models)

The Gemma4 format uses custom delimiters `<|"|>` for string values and special markers for tool calls.

**Test Command:**
```bash
senpi --provider openrouter-gemma --model "google/gemma-4-31b-it" -p "Use bash to run 'date' and tell me the current time"
```

**Expected Behavior:**
- The model should emit a tool call using the Gemma4 delimiter format
- String arguments should be wrapped in `<|"|>` delimiters
- Example output format from model:
  ```
  <|tool_call>call:bash{command:<|"|>date<|"|>}<tool_call|>
  ```
- After execution, the model should receive the tool response and provide the current time

**Protocol Format Details:**
- String delimiter: `<|"|>` (wraps all string values)
- Tool call start marker: `<|tool_call>`
- Tool call end marker: `<tool_call|>`
- Format: `<|tool_call>call:name{key:<|"|>value<|"|>,...}<tool_call|>`
- Tool response prefix: `<|tool_response>` followed by content
- Numbers and booleans are bare values without delimiters

---

## Troubleshooting

### Common Issues

#### Issue: Model returns text instead of tool calls

**Symptoms:** The model responds with plain text describing what it would do, rather than emitting a formatted tool call.

**Possible Causes:**
- The model does not recognize the tool format instructions
- The system prompt was not properly injected with tool definitions
- The model lacks support for the specified `toolCallFormat`

**Solutions:**
1. Verify the model configuration in `models.json` has the correct `compat.toolCallFormat` value
2. Check that the provider is using the `openai-completions` API (required for custom formats)
3. Try a more explicit prompt: "Use the read tool to read package.json"
4. Check the debug logs to see if the system prompt includes tool definitions

#### Issue: Tool call parsing fails

**Symptoms:** Error messages about malformed tool calls or missing parameters.

**Possible Causes:**
- The model emitted an incorrectly formatted tool call
- The middleware parser does not match the model's output format
- Special characters in arguments are not properly escaped

**Solutions:**
1. For Hermes: Verify the JSON inside `<tool_call>` is valid and properly escaped
2. For MorphXml: Check that XML special characters (`<`, `>`, `&`) are properly escaped in values
3. For Gemma4: Ensure string values are wrapped in `<|"|>` delimiters
4. Review the raw model output in debug mode to see exactly what was emitted

#### Issue: Tool responses not being processed

**Symptoms:** The model calls the tool but then does not use the result in its next response.

**Possible Causes:**
- The tool response format does not match what the model expects
- The conversation context was not properly updated with the tool result
- The model is not recognizing the tool response markers

**Solutions:**
1. Verify the tool response is being formatted with the correct protocol-specific wrapper
2. Check that the `toolCallId` is being preserved and passed back correctly
3. Ensure the conversation history includes both the tool call and the tool result message

#### Issue: OpenRouter routing errors

**Symptoms:** "No endpoints available" or "Provider returned error" messages.

**Possible Causes:**
- The specified provider in `openRouterRouting.only` is unavailable
- The model ID is incorrect or deprecated
- API key lacks access to the requested model

**Solutions:**
1. Check OpenRouter's model availability page for the specific model
2. Verify the `openRouterRouting.only` array includes currently available providers
3. Confirm your API key has sufficient credits and model access permissions
4. Try removing the `openRouterRouting` restriction to allow fallback providers

### Debug Mode

To see detailed protocol-level information, enable debug logging:

```bash
DEBUG=pi:* senpi --provider openrouter-qwen --model "qwen/qwen3.5-27b" -p "Read package.json"
```

This will show:
- The formatted system prompt with tool definitions
- Raw model outputs before parsing
- Parsed tool call structures
- Tool response formatting

### Verifying Protocol Selection

To confirm which protocol is being used for a model, check the model configuration:

```bash
senpi --provider <provider> --model <model> --info
```

Look for the `toolCallFormat` field in the output. Valid values are:
- `hermes` - For Qwen and other Hermes-format models
- `xml` or `morphXml` - For Gemini and XML-based models
- `gemma4-delimiter` - For Gemma 4 models
- `native` - For models with native tool calling (OpenAI, Anthropic)

## Summary Table

| Protocol | Provider | Model | Test Command |
|----------|----------|-------|--------------|
| Hermes | openrouter-qwen | qwen/qwen3.5-27b | `senpi --provider openrouter-qwen --model "qwen/qwen3.5-27b" -p "Read package.json"` |
| MorphXml | openrouter-gemini | google/gemini-3-flash-preview | `senpi --provider openrouter-gemini --model "google/gemini-3-flash-preview" -p "List TypeScript files"` |
| Gemma4 | openrouter-gemma | google/gemma-4-31b-it | `senpi --provider openrouter-gemma --model "google/gemma-4-31b-it" -p "Run date command"` |
