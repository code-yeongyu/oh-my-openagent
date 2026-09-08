import type { JSX } from "react"
import { Anvil, BookOpen, Compass, Eye, Hammer, ListChecks, Scale, Search } from "lucide-react"

import { BentoCell, BentoGrid } from "@/components/ledger/bento-cell"
import { LedgerRow } from "@/components/ledger/ledger-row"
import { Reel, ReelCell } from "@/components/ledger/reel"
import { Chip } from "@/components/ui/badge"

import { Showcase, Specimen } from "./showcase"

const EVIDENCE = (
  <pre className="border-line bg-code-bg text-code-fg overflow-x-auto border p-4 font-mono text-sm leading-[1.55]">
    {"$ mass ulw add auth\n> wave 1  orchestrator  planning\n> wave 2  planner       interview"}
  </pre>
)

const REVIEWS = [
  "Replaced three internal tools in a week.",
  "The interview mode catches what I forgot.",
  "First harness that finishes without me.",
  "Wave scheduling makes the plan legible.",
  "Verified at the end, every time.",
  "Ran a 40-file refactor overnight.",
] as const

export function LedgerShowcase(): JSX.Element {
  return (
    <>
      <Showcase id="ledger-row" eyebrow="components/ledger/ledger-row" title="LedgerRow">
        <Specimen label="default / hover (forced) / active" stack>
          <div>
            <LedgerRow index="01" title="Interview before code" evidence={EVIDENCE}>
              The planner researches the codebase and asks only the questions the code cannot
              answer.
            </LedgerRow>
            <LedgerRow
              index="02"
              title="Schedule in waves"
              className="bg-accent-4"
              evidence={EVIDENCE}
            >
              Independent tracks run in parallel; dependent ones wait for the wave before them.
            </LedgerRow>
            <LedgerRow index="03" title="Verify at the end" active evidence={EVIDENCE}>
              The plan reviewer gates the plan; the last wave proves the work against the acceptance
              criteria.
            </LedgerRow>
          </div>
        </Specimen>
      </Showcase>

      <Showcase id="bento" eyebrow="components/ledger/bento-cell" title="BentoCell">
        <Specimen label="2x2 / 2x1 / 1x1 (12 cells, gapless)" stack>
          <BentoGrid>
            <BentoCell
              colSpan={2}
              rowSpan={2}
              icon={<ListChecks />}
              name="Orchestrator"
              role="Lead orchestrator. Plans, delegates, and refuses to stop before the work is verified."
              chip="claude-opus-4"
              active
            />
            <BentoCell
              colSpan={2}
              icon={<Hammer />}
              name="Hephaestus"
              role="Deep worker for long, autonomous implementation runs."
              chip="gpt-5.6"
            />
            <BentoCell icon={<Compass />} name="Planner" role="Interview and plan." chip="opus" />
            <BentoCell icon={<Scale />} name="Metis" role="Pre-plan gap analysis." chip="opus" />
            <BentoCell icon={<Eye />} name="Plan reviewer" role="Plan review gate." chip="opus" />
            <BentoCell icon={<Anvil />} name="Atlas" role="Executes the plan." chip="sonnet" />
            <BentoCell
              icon={<BookOpen />}
              name="Librarian"
              role="Docs and references."
              chip="flash"
            />
            <BentoCell icon={<Search />} name="Explore" role="Fast codebase search." chip="quick" />
          </BentoGrid>
        </Specimen>
      </Showcase>

      <Showcase id="reel" eyebrow="components/ledger/reel" title="Reel">
        <Specimen label="6 cells, owns scroll, arrow keys" stack>
          <div className="-mx-8">
            <Reel label="Reviews">
              {REVIEWS.map((quote, i) => (
                <ReelCell key={quote}>
                  <p className="text-text-hi text-lg leading-[1.35] font-medium tracking-[-0.01em]">
                    {quote}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-6">
                    <span className="text-text-lo text-meta tracking-meta font-mono">
                      review {String(i + 1).padStart(2, "0")}
                    </span>
                    <Chip>github</Chip>
                  </div>
                </ReelCell>
              ))}
            </Reel>
          </div>
        </Specimen>
      </Showcase>
    </>
  )
}
