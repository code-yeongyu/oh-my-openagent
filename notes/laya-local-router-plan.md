# Momo Local AI Router — Implementation Plan

> Future-work note (kaydedildi: 2026-09-28). Hedef: manager'ın seçim kararını local'e
> çekmek; manager için Laya multilingual decision modelini kullanmak. Henüz başlamadı;
> başlarken Phase 0'dan başla. Laya checkpoint/runtime detayları Phase 0/1'de
> resmî implementasyon üzerinden yeniden doğrulanacak.

## 1. Goal

Momo currently uses its manager/catalog system to select an appropriate agent/model for a task.

Add an optional **local semantic routing layer** using the multilingual Laya decision model.

The new architecture should be:

User Prompt
→ Local Laya Router
→ Momo Manager / Catalog
→ Agent / Model

Laya must NOT replace the existing Manager or `catalog_pick`.

Laya should provide semantic information about what the task requires. Momo remains responsible for system-level model selection.

The first goal is NOT to train a new model.

The first goal is to determine whether an existing multilingual Laya checkpoint is accurate and fast enough for Momo.

---

# 2. Important Requirements

### Multilingual

Momo does not know the user's language in advance.

Users may write in:

* English
* Turkish
* Russian
* Arabic
* Spanish
* German
* French
* other supported languages

Do NOT translate the prompt to English solely for the Laya router.

Laya should receive the original user prompt whenever possible.

Momo already has a separate prompt translation/compression system for cloud model calls. The local router should remain independent from that system.

### Local

The router must run locally.

No API request.
No OpenRouter request.
No external inference service.

The goal is zero per-request inference cost.

### Latency

The router is not on a hard realtime path.

Up to approximately 1 second is acceptable.

A 5–10 second inference time would be considered unacceptable.

The model must be loaded once and kept resident.

DO NOT load the model for every request.

### Model count

Momo may have approximately 35–50 available models.

Do NOT assume that every model should be directly compared semantically by Laya.

The system should remain scalable if the catalog grows substantially.

---

# 3. Phase 0 — Inspect Existing Architecture

Before modifying code:

1. Find the current Manager implementation.
2. Find where the Manager receives the user's task.
3. Find where task/category selection occurs.
4. Find `catalog_pick`.
5. Find the model catalog representation.
6. Find the exact point where the final model is selected.
7. Find existing model metadata:

   * provider
   * model ID
   * category
   * cost tier
   * capability
   * context length
   * modality
   * tool support
8. Identify whether the existing catalog already exposes enough metadata to perform deterministic filtering.

Do not duplicate existing catalog logic.

Produce a short architecture note before implementation.

---

# 4. Phase 1 — Create a Standalone Laya PoC

Do NOT integrate Laya into the main routing path yet.

Create a standalone router module.

Suggested conceptual interface:

```ts
type RouteOption = {
  id: string;
  description: string;
};

type RouteResult = {
  selected: string;
  probabilities: Record<string, number>;
  latencyMs: number;
};
```

The implementation should hide all Laya-specific details behind a small interface.

Example:

```ts
const result = await localRouter.choose({
  prompt,
  options,
});
```

The rest of Momo must not know whether the implementation uses Laya, another model, or a future custom model.

---

# 5. Phase 2 — Laya Runtime

Evaluate the multilingual Laya checkpoint.

Use the smallest appropriate multilingual checkpoint first.

Do not fine-tune anything.

The Laya project describes itself as a non-autoregressive decision engine supporting typed choice/score/yes-no decisions and multilingual routing. Use its current official implementation rather than recreating inference manually.

Requirements:

* CPU inference must be supported.
* Model should be loaded once.
* Model should remain resident.
* Avoid spawning a new Python process for every routing request if possible.
* Prefer a persistent local worker/service if the TypeScript runtime cannot efficiently embed the model.

Potential architecture:

```text
Momo / Bun
    │
    │ IPC / localhost
    ▼
Persistent Laya Worker
    │
    └── multilingual model loaded in RAM
```

The worker must support multiple requests without reloading the checkpoint.

---

# 6. Phase 3 — Benchmark on Real Hardware

Benchmark on at least:

### Target machine

11th-generation Intel i5
Integrated GPU
Lightweight laptop

The GPU must NOT be assumed to be usable for inference.

Benchmark CPU inference.

Measure:

1. Model startup/load time
2. First inference latency
3. Warm inference latency
4. p50 latency
5. p95 latency
6. p99 latency
7. RAM usage after loading
8. RAM usage during inference
9. CPU utilization
10. latency with 10, 20, 35, and 50 options

Important: Cold-start latency is separate from inference latency.

A several-second model startup is acceptable if the model is loaded once.

Repeated 5–10 second inference is not acceptable.

---

# 7. Phase 4 — Build a Momo Routing Taxonomy

Do NOT initially give Laya all 35–50 model names.

Create semantic task categories.

For example:

```text
quick
deep
visual-engineering
artistry
ultrabrain
writing
unspecified-low
unspecified-high
```

These categories already exist in Momo and should be reused rather than creating duplicate concepts.

Momo currently routes tasks through these execution categories.

Laya should initially answer:

"What kind of capability does this task require?"

rather than:

"Which exact provider/model should I use?"

Example:

User:

"Why does this Flutter application crash when the EventChannel reconnects?"

Laya:

```json
{
  "debugging": 0.78,
  "coding": 0.12,
  "deep": 0.08,
  "writing": 0.02
}
```

Then Momo decides which concrete model should handle that category.

---

# 8. Phase 5 — Separate Semantic and System Decisions

Maintain this separation:

## Laya

Semantic decision:

```text
What does the user need?
```

Examples:

* coding
* debugging
* research
* visual engineering
* reasoning
* writing
* simple modification
* architecture

## Momo Manager

System decision:

```text
What model should actually execute it?
```

Momo considers:

* model availability
* provider
* cost
* latency
* context window
* tool support
* model pool
* capability metadata
* user configuration
* current provider availability

Do NOT send these deterministic constraints into Laya.

---

# 9. Phase 6 — Use Existing Catalog Logic

The existing Momo catalog already dynamically discovers providers/models and has `catalog_pick`.

Reuse it.

The intended pipeline is:

```text
User Prompt
    │
    ▼
Local Laya
    │
    │ semantic scores
    ▼
Momo Manager
    │
    │ deterministic filtering
    ▼
Candidate Models
    │
    ▼
catalog_pick
    │
    ▼
Final Model
```

Do not create a second model catalog.

Do not create a second pricing system.

Do not duplicate provider filtering.

---

# 10. Phase 7 — Confidence / Uncertainty Handling

Do not blindly trust Laya's highest probability.

For example:

```text
coding:     0.38
reasoning:  0.34
research:   0.28
```

This is an ambiguous task.

The system should detect ambiguity.

Define a configurable threshold.

Example concept:

```ts
if (topScore < MIN_CONFIDENCE) {
    fallbackToExistingManager();
}
```

Also consider the margin:

```ts
margin = topScore - secondScore
```

If:

```text
topScore = 0.42
secondScore = 0.40
```

the router should be considered uncertain.

Do not interpret Laya's probability as a guaranteed probability of correctness.

Use it as a routing signal.

---

# 11. Phase 8 — Exact Model Routing Experiment

Only after category routing works should we test direct model selection.

Create a controlled experiment:

```text
Prompt
  │
  ▼
Laya
  │
  ├── candidate A
  ├── candidate B
  ├── candidate C
  └── ...
```

Test:

* 10 models
* 20 models
* 35 models
* 50 models

Measure whether adding more choices causes degradation.

Do not make this the production path until benchmark results justify it.

---

# 12. Phase 9 — Real Multilingual Dataset

Create a small evaluation dataset.

Do not train yet.

Use real Momo-like tasks in multiple languages.

Example:

### Turkish

```text
Bu fonksiyon neden null döndürüyor?
```

### English

```text
Why does this function return null?
```

### Russian

```text
Почему эта функция возвращает null?
```

### German

```text
Warum gibt diese Funktion null zurück?
```

### Spanish

```text
¿Por qué esta función devuelve null?
```

Include:

* coding
* debugging
* research
* architecture
* writing
* UI/frontend
* simple edits
* complex reasoning
* ambiguous tasks

Target initially:

```text
20–50 prompts per language/category combination
```

The purpose is evaluation, not training.

---

# 13. Phase 10 — Compare Against Existing Momo

Run an A/B benchmark.

### Baseline

Current Momo:

```text
Prompt
→ existing Manager
→ catalog_pick
→ model
```

### Experiment

```text
Prompt
→ Laya
→ Manager
→ catalog_pick
→ model
```

Measure:

1. Routing accuracy
2. Wrong-agent rate
3. Ambiguous-task fallback rate
4. Latency
5. RAM
6. Number of cloud calls
7. Estimated token cost
8. End-to-end task success

Do not assume Laya improves the system simply because it is faster.

The actual metric is whether it improves or maintains routing quality while reducing overhead.

---

# 14. Phase 11 — OpenRouter

Do NOT add OpenRouter-specific logic to Laya.

If OpenRouter is later added, it should simply become another provider in the existing Momo catalog.

Architecture:

```text
                 ┌── OpenAI
                 ├── Anthropic
                 ├── Google
                 ├── OpenRouter
                 ├── local Ollama
                 └── other providers
                        │
                        ▼
                 Momo Model Catalog
                        │
                        ▼
                   catalog_pick
```

Laya should remain provider-agnostic.

If OpenRouter produces hundreds of models, Momo's catalog filtering must reduce the candidate set before any semantic model selection.

Never ask Laya to understand hundreds of raw provider model IDs.

---

# 15. Phase 12 — Production Integration

Only after the benchmark succeeds:

Add configuration similar to:

```json
{
  "local_router": {
    "enabled": true,
    "model": "laya-multilingual",
    "host": "localhost",
    "timeout_ms": 1500,
    "confidence_threshold": 0.60,
    "margin_threshold": 0.10,
    "fallback": "manager"
  }
}
```

Exact configuration names can be adapted to existing Momo conventions.

Important defaults:

* router disabled if model/runtime unavailable
* automatic fallback to current Manager
* never block the entire Momo workflow because local routing failed
* never make a cloud request just because Laya failed
* log routing failures separately

---

# 16. Logging

Add optional debug logging:

```text
[MOMO ROUTER]
language: tr
latency: 183ms

scores:
  debugging: 0.71
  coding: 0.18
  architecture: 0.08
  writing: 0.03

selected_category: debugging
confidence: 0.71
margin: 0.53

fallback: false
```

Do not log full user prompts by default if they may contain sensitive project data.

Provide an explicit debug mode for detailed evaluation.

---

# 17. Failure Modes

The router must gracefully handle:

### Model unavailable

```text
Laya unavailable
→ existing Manager
```

### Timeout

```text
Laya timeout
→ existing Manager
```

### Low confidence

```text
Laya uncertain
→ existing Manager
```

### Unsupported language

```text
Laya uncertain
→ existing Manager
```

### Empty catalog

```text
Existing catalog behavior
```

### OpenRouter/provider failure

```text
Existing Momo provider fallback
```

Laya must never become a single point of failure.

---

# 18. Do NOT Fine-Tune Yet

Do not train a custom Momo router during this implementation.

First determine:

```text
Does multilingual Laya already solve the problem?
```

Only consider fine-tuning if the benchmark shows systematic routing failures.

If fine-tuning becomes necessary later, use Momo's real-world routing logs to construct the dataset.

Potential future dataset:

```text
user_prompt
+
available_categories
+
chosen_category
+
successful_model
+
task_success
```

Do not train from synthetic examples only.

---

# 19. Success Criteria

The PoC is successful if all of the following are approximately true:

### Performance

* warm inference generally < 1 second on the target Intel i5
* no repeated model loading
* no 5–10 second per-request delays
* acceptable RAM usage

### Multilingual

Routing remains usable across multiple languages without translating the prompt first.

### Quality

Laya-assisted routing is at least comparable to the current Manager on the evaluation dataset.

### Reliability

Laya failure does not break Momo.

### Architecture

The router remains independent from:

* provider implementations
* OpenRouter
* model catalog internals
* individual agent implementations

### Maintainability

Replacing Laya later with:

* another local model
* a custom fine-tuned model
* a different decision engine

should require changing only the router implementation.

---

# 20. Final Desired Architecture

```text
                         USER
                          │
                          ▼
                  ┌───────────────┐
                  │ Local Router  │
                  │ Laya 322M     │
                  │ multilingual  │
                  └───────┬───────┘
                          │
                    semantic scores
                          │
                          ▼
                  ┌───────────────┐
                  │ Momo Manager  │
                  └───────┬───────┘
                          │
                category / capability
                          │
                          ▼
                  ┌───────────────┐
                  │ Model Catalog │
                  │ + filters     │
                  └───────┬───────┘
                          │
                    candidate pool
                          │
                          ▼
                  ┌───────────────┐
                  │ catalog_pick  │
                  └───────┬───────┘
                          │
                          ▼
                ┌───────────────────┐
                │ Selected Provider │
                │ / Model / Agent   │
                └───────────────────┘
```

The key architectural principle is:

**Laya decides what the task means. Momo decides what to do about it.**

Do not turn Laya into another Manager.

---

# Immediate Task for the Coding Agent

Start with Phase 0 only.

Inspect the current Momo repository and identify:

1. Manager implementation
2. `catalog_pick`
3. model catalog data structures
4. task categories
5. exact model-selection flow
6. existing logging/benchmark infrastructure

Then produce a concise implementation map with exact files and functions.

Do not modify production routing yet.

After the architecture map is produced, implement the standalone Laya PoC and benchmark it on the local machine before integrating it into Momo.
