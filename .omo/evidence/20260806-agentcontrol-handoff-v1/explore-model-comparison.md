# Explore model comparison: Sol vs Luna

## Result

On this two-run, source-tracing benchmark, Luna preserved all eight required acceptance atoms while averaging 8.2% lower wall time and producing reports 23.9% shorter than Sol. Sol's reports were slightly stronger on non-obvious risk discovery. The sample is too small and latency variance is too high to justify changing the current Sol default from this result alone.

For routine, well-scoped Explore work with a strong handoff, Luna is the better speed and brevity candidate. Keep Sol for ambiguous investigations where deeper edge-case discovery is more valuable than latency until a broader benchmark confirms the tradeoff.

## Method

- Both models received the same `agentcontrol-explore` preset, task prompt, source revision, and validated `agentcontrol-handoff/v1` document.
- Each model ran twice through real `opencode run --agent agentcontrol-explore --format json`.
- Every run used a fresh isolated XDG sandbox. The runner copied authentication into the temporary data directory, never wrote credentials to evidence, and removed the sandbox and AgentControl runtime state after each series.
- The task required eight concrete implementation claims, current file/line citations, exactly four report sections, and one final `Report` call.
- Raw metrics are in `explore-model-metrics.json`; the four detailed reports are stored beside this file.

## Performance

| Metric, two-run average | Sol | Luna | Luna difference |
|---|---:|---:|---:|
| Wall time | 183.863 s | 168.756 s | 8.2% lower |
| Input tokens | 100,934 | 97,087.5 | 3.8% lower |
| Output tokens | 3,514.5 | 3,156.5 | 10.2% lower |
| Reasoning tokens | 623.5 | 609.5 | 2.2% lower |
| Detailed report size | 9,529.5 bytes | 7,255.5 bytes | 23.9% lower |

Sol latency varied from 137.543 to 230.183 seconds. Luna varied from 164.918 to 172.594 seconds. With only two runs per model, the average indicates direction rather than statistical significance.

## Quality rubric

The reviewer-applied rubric was: acceptance-atom coverage 40 points, source and citation accuracy 30, risk depth 20, and required format plus conciseness 10.

| Run | Acceptance atoms | Citation check | Risk depth | Format and conciseness | Total |
|---|---:|---:|---:|---:|---:|
| Sol 1 | 40 | 30 | 20 | 8 | 98 |
| Sol 2 | 40 | 30 | 20 | 9 | 99 |
| Luna 1 | 40 | 30 | 17 | 10 | 97 |
| Luna 2 | 40 | 30 | 16 | 10 | 96 |
| **Average** | **40** | **30** | **18.25 vs 16.5** | **8.5 vs 10** | **98.5 Sol / 96.5 Luna** |

All four reports covered all eight acceptance atoms and used the required `Flow`, `Rejection`, `Dashboard`, and `Risks` headings. Spot checks found no incorrect material source claim or citation in either model's reports.

Sol's advantage came from identifying more consequential implementation risks, especially the optional internal `handoff` parameter as a possible future bypass, source revision being presence-only, and the distinction between dashboard digest enforcement and worker prompt-level enforcement. Luna found the core digest and source-revision limitations but spent some risk budget restating architecture or test coverage.

Luna's reports were materially shorter without losing required coverage. Its summaries also captured the end-to-end contract and dashboard substitution defense accurately.

## Decision boundary

- **Choose Luna** for a bounded Explore task whose handoff already supplies authoritative paths and explicit acceptance atoms. In this sample it retained required quality with lower latency and less output.
- **Choose Sol** for broad, ambiguous, security-sensitive, or architecture-risk exploration where finding one additional bypass or stale-assumption edge can outweigh a modest latency cost.
- **Do not change the default yet.** Repeat this benchmark across at least three different repository tasks and five runs per model, then compare paired medians and reviewer-blind scores.
