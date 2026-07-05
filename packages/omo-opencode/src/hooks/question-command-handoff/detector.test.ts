import { describe, expect, test } from "bun:test"

import { resolveAnsweredCommandReference, type AnsweredQuestion } from "./detector"

const knownCommandNames = new Set(["start-work", "hyperplan"])

const handoffQuestions: AnsweredQuestion[] = [
  {
    question: "Plan ready. What next?",
    options: [
      {
        label: "Start Work",
        description: "Execute now with `/start-work {name}`. Plan looks solid.",
      },
      {
        label: "High Accuracy Review",
        description: "Run an extra review pass before executing.",
      },
    ],
  },
]

describe("resolveAnsweredCommandReference", () => {
  test("resolves the command for an answered option that references it", () => {
    //#given a single-select answer picking the command-bearing option
    const answers = [["Start Work"]]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions: handoffQuestions,
      answers,
      knownCommandNames,
    })

    //#then
    expect(resolved).toBe("start-work")
  })

  test("resolves a plain (non-backticked) mid-text reference", () => {
    //#given
    const questions: AnsweredQuestion[] = [
      {
        question: "Continue?",
        options: [{ label: "Go", description: "Kick off via /hyperplan right away" }],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Go"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBe("hyperplan")
  })

  test("returns null for an option without a command reference", () => {
    //#given
    const answers = [["High Accuracy Review"]]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions: handoffQuestions,
      answers,
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("ignores unregistered slash tokens such as URLs and prose", () => {
    //#given
    const questions: AnsweredQuestion[] = [
      {
        question: "Docs?",
        options: [
          { label: "Read", description: "See https://example.com/start and/or the docs" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Read"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns null for multi-question forms", () => {
    //#given
    const questions = [...handoffQuestions, ...handoffQuestions]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Start Work"], ["Start Work"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns null for multi-select answers", () => {
    //#given
    const answers = [["Start Work", "High Accuracy Review"]]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions: handoffQuestions,
      answers,
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns null for a typed custom answer that matches no option", () => {
    //#given
    const answers = [["do something else entirely"]]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions: handoffQuestions,
      answers,
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns null when the option declines the command it mentions", () => {
    //#given
    const questions: AnsweredQuestion[] = [
      {
        question: "Continue?",
        options: [
          { label: "Hold off", description: "Skip /start-work for now and refine the plan" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Hold off"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns null when the declining option uses a curly apostrophe", () => {
    //#given a negated option written with U+2019 instead of an ASCII apostrophe
    const questions: AnsweredQuestion[] = [
      {
        question: "Continue?",
        options: [
          { label: "Hold off", description: "Don’t run /start-work yet" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Hold off"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("does not treat a negation marker inside a larger word as a decline", () => {
    //#given "collateral" contains the marker "later" as a substring
    const questions: AnsweredQuestion[] = [
      {
        question: "Continue?",
        options: [
          { label: "Go", description: "Review the collateral docs and run /start-work" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Go"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBe("start-work")
  })

  test("ignores a registered command name inside a URL path", () => {
    //#given a URL whose path segment matches a registered command
    const questions: AnsweredQuestion[] = [
      {
        question: "Docs?",
        options: [
          { label: "Read", description: "See https://example.com/start-work for details" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Read"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })

  test("returns the first registered command when several are referenced", () => {
    //#given
    const questions: AnsweredQuestion[] = [
      {
        question: "Continue?",
        options: [
          { label: "Go", description: "Either /hyperplan first or /start-work directly" },
        ],
      },
    ]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions,
      answers: [["Go"]],
      knownCommandNames,
    })

    //#then
    expect(resolved).toBe("hyperplan")
  })

  test("returns null for empty answers", () => {
    //#given
    const answers: string[][] = [[]]

    //#when
    const resolved = resolveAnsweredCommandReference({
      questions: handoffQuestions,
      answers,
      knownCommandNames,
    })

    //#then
    expect(resolved).toBeNull()
  })
})
