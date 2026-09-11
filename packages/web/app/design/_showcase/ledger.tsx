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
        <Specimen label="2x2 / 2x1 / 1x1 (12 grid units, gapless)" stack>
          <BentoGrid>
            <BentoCell
              colSpan={2}
              rowSpan={2}
              icon={<ListChecks />}
              name="Orchestrator"
              role="The main agent"
              chip="Your session model"
              active
            />
            <BentoCell
              colSpan={2}
              icon={<Compass />}
              name="Planner"
              role="/ulw-plan planning interview"
              chip="Runs in the main session"
            />
            <BentoCell
              icon={<Scale />}
              name="Plan Consultant"
              role="Gap analysis"
              chip="Claude Sonnet 4.6"
            />
            <BentoCell
              icon={<Eye />}
              name="Plan Reviewer"
              role="Plan review gate"
              chip="GPT 6 Astra xHigh"
            />
            <BentoCell
              icon={<Anvil />}
              name="Architect"
              role="Architecture consult lane"
              chip="Claude Fable 5.1 Max"
            />
            <BentoCell
              icon={<Hammer />}
              name="Deep"
              role="Deep autonomous problem-solving"
              chip="GPT 6 Astra High"
            />
            <BentoCell
              icon={<BookOpen />}
              name="Librarian"
              role="Docs and code search"
              chip="GPT 5.6 Luna Fast"
            />
            <BentoCell
              icon={<Search />}
              name="Explore"
              role="Codebase grep"
              chip="GPT 5.6 Luna Fast"
            />
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
