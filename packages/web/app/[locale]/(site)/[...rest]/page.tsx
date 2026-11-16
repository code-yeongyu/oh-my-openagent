import { notFound } from "next/navigation"

/** An unmatched path under a locale 404s inside that locale's shell, so the page keeps its language. */
export default function UnmatchedLocalePath(): never {
  notFound()
}
