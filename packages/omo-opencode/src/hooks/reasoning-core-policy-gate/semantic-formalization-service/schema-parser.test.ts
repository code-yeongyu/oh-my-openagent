import { describe, expect, it } from "bun:test"
import { FormalizationError } from "./errors"
import { createSchemaParser } from "./schema-parser"

const logger = {
  warn() {
    return undefined
  },
}

describe("createSchemaParser", () => {
  describe("#given well-formed JSON matching TheorySchema", () => {
    describe("#when parse", () => {
      it("#then returns validated Theory", () => {
        const parser = createSchemaParser({ logger })

        const theory = parser.parse(
          JSON.stringify({
            premises: [{ formula: "problem(current)" }],
          }),
        )

        expect(theory).toEqual({
          premises: [{ formula: "problem(current)", kind: "ordinary" }],
          classical_negation: true,
        })
      })
    })
  })

  describe("#given malformed JSON string", () => {
    describe("#when parse", () => {
      it("#then throws FormalizationError code schema_invalid reason malformed_json", () => {
        const parser = createSchemaParser({ logger })

        expect(() => parser.parse("not json")).toThrow(
          new FormalizationError({
            code: "schema_invalid",
            message: "LLM returned malformed JSON",
            details: expect.objectContaining({ reason: "malformed_json" }),
          }),
        )
      })
    })
  })

  describe("#given valid JSON but missing premises", () => {
    describe("#when parse", () => {
      it("#then throws FormalizationError code schema_invalid reason zod_violation with field errors", () => {
        const parser = createSchemaParser({ logger })

        try {
          parser.parse(JSON.stringify({}))
          throw new Error("expected parse to throw")
        } catch (error) {
          expect(error).toBeInstanceOf(FormalizationError)
          expect(error).toMatchObject({
            code: "schema_invalid",
            message: "LLM output failed schema validation",
            details: {
              reason: "zod_violation",
              field_errors: {
                fieldErrors: {
                  premises: expect.any(Array),
                },
              },
            },
          })
        }
      })
    })
  })

  describe("#given valid JSON with extra unknown fields", () => {
    describe("#when parse", () => {
      it("#then strips extras and returns valid Theory", () => {
        const parser = createSchemaParser({ logger })

        const theory = parser.parse(
          JSON.stringify({
            premises: [{ formula: "problem(current)", extra_kind: "ignored" }],
            extra_root: "ignored",
          }),
        )

        expect(theory).toEqual({
          premises: [{ formula: "problem(current)", kind: "ordinary" }],
          classical_negation: true,
        })
      })
    })
  })

  describe("#given JSON with classical_negation explicitly false", () => {
    describe("#when parse", () => {
      it("#then throws FormalizationError code schema_invalid for ASPIC+ contract violation", () => {
        const parser = createSchemaParser({ logger })

        try {
          parser.parse(
            JSON.stringify({
              premises: [{ formula: "problem(current)" }],
              classical_negation: false,
            }),
          )
          throw new Error("expected parse to throw")
        } catch (error) {
          expect(error).toBeInstanceOf(FormalizationError)
          expect(error).toMatchObject({
            code: "schema_invalid",
            message: "LLM output failed schema validation",
            details: {
              reason: "zod_violation",
            },
          })
        }
      })
    })
  })
})
