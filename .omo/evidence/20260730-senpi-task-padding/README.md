# Senpi task argument padding QA

## What was tested

This evidence set covers GPT-style optional-field padding at the Senpi `task`
tool boundary, including single spawn, batch spawn, genuine ambiguous input,
and the task prompt guidance consumed by the model.

## What was observed

The isolated branch starts from `origin/dev` at
`915c5e4a9f922099bd15b96fdd4c0b128c70e034` with a clean status. RED, GREEN,
manual harness output, and cleanup receipts are added as the scenarios run.

## Why it is enough

The focused tests pin semantic normalization at the argument boundary. The
manual QA drives the real Senpi task surface to prove that provider-shaped
calls spawn children instead of returning the prompt/tasks XOR error.

## What was omitted

No credentials, raw environment dumps, auth headers, or private model traffic
are stored. Runtime captures are sanitized to the invocation shape, task ids,
terminal statuses, and decisive error or success text.
