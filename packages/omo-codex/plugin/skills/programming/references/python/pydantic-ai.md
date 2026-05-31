# PydanticAI Reference (v1.x, 2026)

> Canonical patterns for wiring PydanticAI agents. Target: production usage, late-2025 / 2026.
> Source: [ai.pydantic.dev](https://ai.pydantic.dev) and [pydantic/pydantic-ai@`cad9569`](https://github.com/pydantic/pydantic-ai/blob/cad956910079737ea0886b50cef15777208f92e6).

---

## 1. Agent Constructor

```python
from pydantic_ai import Agent

agent = Agent(
    'openai:gpt-5.2',               # model (str | Model | None)
    output_type=MyOutputModel,       # structured output type; default=str
    instructions='You are a...',     # static or callable instructions
    system_prompt='Be concise.',     # static system prompt(s)
    deps_type=MyDeps,                # dependency type for type-checking only
    name='my-agent',                 # optional, inferred from var name if omitted
    retries=1,                       # default retries for tools + output validation
    output_retries=None,             # override retries for output validation only
    tools=[my_tool],                 # list of Tool objects or plain functions
    defer_model_check=False,         # set True to skip env-var check at init time
    end_strategy='early',            # 'early' | 'graceful' | 'exhaustive'
)
```

**Breaking change (v1.88.0)**: `result_type` was renamed to `output_type`. Use `output_type`.

---

## 2. Model Strings

Format: `provider:model-name`. The framework infers the provider from the prefix.

| Provider prefix | Example |
|---|---|
| `openai:` | `'openai:gpt-5.2'`, `'openai:gpt-4o'` |
| `anthropic:` | `'anthropic:claude-sonnet-4-6'`, `'anthropic:claude-opus-4-1'` |
| `google-gla:` | `'google-gla:gemini-3-flash-preview'` |
| `google-vertex:` | `'google-vertex:gemini-3-pro-preview'` |
| `bedrock:` | `'bedrock:anthropic.claude-sonnet-4-6'` |
| `xai:` / `grok:` | `'xai:grok-3'`, `'grok:grok-3-fast'` |
| `deepseek:` | `'deepseek:deepseek-chat'` |
| `cohere:` | `'cohere:command-r-08-2024'` |
| `gateway/...` | `'gateway/openai:gpt-5.2'` (PydanticAI Gateway) |

Model can also be omitted at construction and passed per-run: `agent.run(prompt, model='openai:gpt-5.2')`.

---

## 3. Tools

### Decorator syntax

```python
from pydantic_ai import Agent, RunContext

agent = Agent('openai:gpt-5.2', deps_type=str)

@agent.tool                    # default: receives RunContext as first arg
async def greet(ctx: RunContext[str], name: str) -> str:
    return f"Hello {ctx.deps}, {name}!"

@agent.tool_plain              # no context needed
async def roll_dice(sides: int) -> int:
    import random
    return random.randint(1, sides)
```

### `RunContext[Deps]`

First parameter of `@agent.tool` functions. Carries:

- `ctx.deps` — the dependency instance
- `ctx.model` — the model being used
- `ctx.usage` — token usage so far
- `ctx.messages` — conversation history
- `ctx.retry` / `ctx.max_retries` — current retry count
- `ctx.agent` — the running agent instance

Use `@agent.tool_plain` when the tool does **not** need any of the above.

---

## 4. Structured Output

Pass a Pydantic `BaseModel` (or `bool`, `int`, `list[str]`, etc.) as `output_type`. The result is accessed via `.output`.

```python
from pydantic import BaseModel
from pydantic_ai import Agent

class City(BaseModel):
    name: str
    country: str
    population_millions: float

agent = Agent('openai:gpt-5.2', output_type=City)
result = agent.run_sync('Tell me about Tokyo')
print(result.output)            # City(name='Tokyo', country='Japan', ...)
print(result.output.name)       # 'Tokyo'
```

**Note**: `result.data` was renamed; the canonical accessor is `result.output`.

---

## 5. Async vs Sync

| Method | Mode | Returns |
|---|---|---|
| `await agent.run(prompt, ...)` | async | `AgentRunResult[OutputDataT]` |
| `agent.run_sync(prompt, ...)` | sync | `AgentRunResult[OutputDataT]` |
| `async with agent.run_stream(prompt, ...) as response:` | async streaming | `StreamedRunResult` |

```python
# Sync
result = agent.run_sync('What is the capital of Italy?')
print(result.output)

# Async
result = await agent.run('What is the capital of France?')
print(result.output)

# Streaming
async with agent.run_stream('What is the capital of the UK?') as response:
    async for text in response.stream_text():
        print(text, end='')
    # After streaming finishes:
    print(response.output)
```

`run_sync()` is a convenience wrapper over `loop.run_until_complete(self.run(...))`. Do not use it inside an active async context.

---

## 6. Dependencies

Use a `@dataclass` container, pass the **type** to `deps_type`, and pass an **instance** to `deps` at run time.

```python
from dataclasses import dataclass
import httpx
from pydantic_ai import Agent, RunContext

@dataclass
class Deps:
    api_key: str
    http_client: httpx.AsyncClient

agent = Agent(
    'openai:gpt-5.2',
    deps_type=Deps,
)

@agent.tool
async def fetch_data(ctx: RunContext[Deps], endpoint: str) -> str:
    r = await ctx.deps.http_client.get(
        endpoint,
        headers={'Authorization': f'Bearer {ctx.deps.api_key}'},
    )
    r.raise_for_status()
    return r.text

async def main():
    async with httpx.AsyncClient() as client:
        deps = Deps(api_key='sk-...', http_client=client)
        result = await agent.run('Get /users', deps=deps)
        print(result.output)
```

---

## 7. Error Types & Retrying from a Tool

```python
from pydantic_ai import Agent, ModelRetry, UnexpectedModelBehavior, capture_run_messages

agent = Agent('openai:gpt-5.2', retries=3)

@agent.tool_plain
def calc_volume(size: int) -> int:
    if size == 42:
        return size ** 3
    raise ModelRetry('Please try again with size 42.')

with capture_run_messages() as messages:
    try:
        result = agent.run_sync('Get the volume of a box with size 6.')
    except UnexpectedModelBehavior as e:
        print('Error:', e)          # "Tool 'calc_volume' exceeded max retries count of 3"
        print('Cause:', e.__cause__)  # ModelRetry('Please try again...')
        print('Messages:', messages)
```

- **`ModelRetry`** — raise from a tool, output validator, or capability hook to ask the model to retry.
- **`UnexpectedModelBehavior`** — raised when the retry limit is exceeded or the model API returns an unrecoverable error.
- **`capture_run_messages()`** — context manager that records all messages exchanged during a run for debugging.

---

## 8. Logfire Integration

One-line setup if the `logfire` extra is installed (included in the default `pydantic-ai` package):

```python
import logfire

logfire.configure()               # reads token from .logfire directory
logfire.instrument_pydantic_ai()  # auto-traces all agent runs
```

Alternatively, set `instrument=True` on the agent:

```python
agent = Agent('openai:gpt-5.2', instrument=True)
```

---

## 9. Minimal Complete Snippets

### (a) Basic agent with structured output

```python
from pydantic import BaseModel
from pydantic_ai import Agent

class City(BaseModel):
    name: str
    country: str

agent = Agent('openai:gpt-5.2', output_type=City)
result = agent.run_sync('Tell me about Paris')
print(result.output)   # City(name='Paris', country='France')
```

### (b) Agent with tools and dependencies

```python
from dataclasses import dataclass
from pydantic_ai import Agent, RunContext

@dataclass
class Deps:
    api_key: str

agent = Agent('openai:gpt-5.2', deps_type=Deps)

@agent.tool
async def get_secret(ctx: RunContext[Deps], code: str) -> str:
    if code == '1234':
        return f'secret-for-{ctx.deps.api_key}'
    return 'wrong code'

result = agent.run_sync('My code is 1234', deps=Deps(api_key='sk-abc'))
print(result.output)
```

### (c) Async streaming

```python
import anyio
from pydantic_ai import Agent

agent = Agent('openai:gpt-5.2')

async def main() -> None:
    async with agent.run_stream('Write a haiku about Python') as response:
        async for text in response.stream_text():
            print(text, end='')
        print('\n---')
        print('Final:', response.output)

anyio.run(main)
```

---

## Version Notes

- **V1** reached API stability in September 2025. Breaking changes are reserved for V2 (earliest April 2026).
- **v1.88.0** renamed `result_type` → `output_type` and `result_tool_name` / `result_tool_description` were removed. Use `output_type`.
- The canonical accessor for run results is `result.output` (not `result.data`).
