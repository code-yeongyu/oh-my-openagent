import { expect, test } from "bun:test"
import { experimentFixture, result, evidence, assessment } from "./tests/fixture.ts"

// Closure is the success claim of an initiative: a cite must point at evidence that can establish
// impact (observed measurement or affected/stakeholder feedback), never at a simulation or inference.
test.each([
  { status: "achieved", provenance: "simulated", kind: "measurement" },
  { status: "achieved", provenance: "simulated", kind: "feedback" },
  { status: "achieved", provenance: "inferred", kind: "measurement" },
  { status: "achieved", provenance: "observed", kind: "technical" },
  { status: "irrelevant", provenance: "simulated", kind: "measurement" },
] as const)(
  "#given a $status resolution backed by observed evidence #when closure cites only $provenance $kind evidence #then the close is refused",
  async ({ status, provenance, kind }) => {
    // given
    const { record, sdk } = await experimentFixture()
    await record(evidence())
    await record(
      evidence({
        id: "unsupported",
        provenance,
        kind,
        summary: "Not an impact observation",
        refs: ["x:1"],
      }),
    )
    const { snapshot } = await record(
      assessment({
        outcomes: [
          {
            outcomeId: "time",
            status,
            evidenceIds: ["unsupported", "observed"],
          },
        ],
      }),
    )

    // when
    const closed = await sdk.record({
      expectedRevision: snapshot.revision,
      event: {
        type: "close",
        resolution: status,
        reason: "Cited unsupported evidence",
        evidenceIds: ["unsupported"],
      },
    })

    // then
    expect(closed).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    })
    expect(result(await sdk.status()).records.lifecycle).toBe("active")
  },
)

test.each([{ cited: ["observed"] }, { cited: ["unsupported", "observed"] }])(
  "#given a resolution backed by observed evidence #when closure cites $cited #then the close succeeds",
  async ({ cited }) => {
    // given
    const { record, sdk } = await experimentFixture()
    await record(evidence())
    await record(
      evidence({
        id: "unsupported",
        provenance: "simulated",
        summary: "Synthetic",
        refs: ["x:1"],
      }),
    )
    const { snapshot } = await record(
      assessment({
        outcomes: [
          {
            outcomeId: "time",
            status: "achieved",
            evidenceIds: ["unsupported", "observed"],
          },
        ],
      }),
    )

    // when
    const closed = await sdk.record({
      expectedRevision: snapshot.revision,
      event: {
        type: "close",
        resolution: "achieved",
        reason: "Cited observed evidence",
        evidenceIds: [...cited],
      },
    })

    // then
    expect(closed).toMatchObject({
      ok: true,
      result: { records: { lifecycle: "closed" } },
    })
  },
)
