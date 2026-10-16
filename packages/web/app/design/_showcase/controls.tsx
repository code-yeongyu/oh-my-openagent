import type { JSX } from "react"
import { ArrowRight, Copy } from "lucide-react"

import { Eyebrow } from "@/components/ledger/eyebrow"
import { Chip } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { Showcase, Specimen } from "./showcase"

const VARIANTS = ["primary", "secondary", "ghost", "link"] as const
const SIZES = ["sm", "md", "lg"] as const

export function ControlsShowcase(): JSX.Element {
  return (
    <>
      <Showcase id="buttons" eyebrow="components/ui/button" title="Button">
        {SIZES.map((size) => (
          <Specimen key={size} label={`size ${size}`}>
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} size={size}>
                {variant}
                {variant === "link" ? <ArrowRight /> : null}
              </Button>
            ))}
          </Specimen>
        ))}
        <Specimen label="icon">
          <Button variant="ghost" size="icon" aria-label="Copy">
            <Copy />
          </Button>
          <Button variant="secondary" size="icon" aria-label="Copy">
            <Copy />
          </Button>
        </Specimen>
        <Specimen label="hover (forced)">
          <Button className="bg-accent-dim">primary</Button>
          <Button variant="secondary" className="border-accent-32 text-accent">
            secondary
          </Button>
          <Button variant="ghost" className="text-text-hi">
            ghost
          </Button>
        </Specimen>
        <Specimen label="active (forced)">
          <Button className="translate-y-px">primary</Button>
        </Specimen>
        <Specimen label="disabled">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} disabled>
              {variant}
            </Button>
          ))}
        </Specimen>
        <Specimen label="focus-visible">
          <Button className="outline-accent-32 outline-2 outline-offset-2">primary</Button>
          <Button variant="secondary" className="outline-accent-32 outline-2 outline-offset-2">
            secondary
          </Button>
        </Specimen>
      </Showcase>

      <Showcase id="chips" eyebrow="components/ui/badge" title="Chip">
        <Specimen label="default">
          <Chip>claude-opus-4</Chip>
          <Chip>gpt-5.6</Chip>
          <Chip>12:04:31</Chip>
        </Specimen>
        <Specimen label="accent (live / selected)">
          <Chip variant="accent">running</Chip>
          <Chip variant="accent">wave 02</Chip>
        </Specimen>
      </Showcase>

      <Showcase id="eyebrow" eyebrow="components/ledger/eyebrow" title="Eyebrow">
        <Specimen label="plain">
          <Eyebrow>Primary orchestrator</Eyebrow>
        </Specimen>
        <Specimen label="rule">
          <Eyebrow rule>Primary orchestrator</Eyebrow>
        </Specimen>
        <Specimen label="dot">
          <Eyebrow dot="ok">Verified</Eyebrow>
          <Eyebrow dot="busy">Working</Eyebrow>
          <Eyebrow dot="err">Blocked</Eyebrow>
          <Eyebrow dot="accent">Live</Eyebrow>
        </Specimen>
        <Specimen label="rule + dot">
          <Eyebrow rule dot="accent">
            Wave 02 · Planners
          </Eyebrow>
        </Specimen>
      </Showcase>

      <Showcase id="input" eyebrow="components/ui/input" title="Input">
        <Specimen label="default">
          <Input placeholder="Search docs..." className="max-w-xs" />
        </Specimen>
        <Specimen label="disabled">
          <Input placeholder="Search docs..." className="max-w-xs" disabled />
        </Specimen>
      </Showcase>
    </>
  )
}
