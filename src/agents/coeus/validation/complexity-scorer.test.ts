import { describe, it, expect } from "bun:test";
import { scoreComplexity } from "./complexity-scorer";
import { DECOMPOSITION_THRESHOLD } from "../types";

describe("complexity-scorer", () => {
  describe("scoreComplexity", () => {
    describe("simple tasks → below threshold", () => {
      //#given a simple typo fix request
      //#when scoring complexity
      //#then total < 40 (no decomposition needed)
      it("scores 'Fix typo in login button' below threshold", () => {
        const result = scoreComplexity("Fix typo in login button");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(false);
        expect(result.concern_count).toBeLessThanOrEqual(1);
      });

      //#given a single-page UI change
      //#when scoring complexity
      //#then total < 40
      it("scores 'Add dark mode to settings page' below threshold", () => {
        const result = scoreComplexity("Add dark mode to settings page");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(false);
      });

      //#given a simple bug fix
      //#when scoring complexity
      //#then total < 40
      it("scores 'Fix null pointer in user profile' below threshold", () => {
        const result = scoreComplexity("Fix null pointer in user profile");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
      });

      //#given a single file rename request
      //#when scoring complexity
      //#then total < 40, minimal concerns
      it("scores 'Rename variable foo to bar' below threshold", () => {
        const result = scoreComplexity("Rename variable foo to bar");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
        expect(result.concern_count).toBeLessThanOrEqual(1);
      });

      //#given a simple CSS change
      //#when scoring complexity
      //#then total < 40
      it("scores 'Change button color to blue' below threshold", () => {
        const result = scoreComplexity("Change button color to blue");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
      });
    });

    describe("complex multi-domain tasks → above threshold", () => {
      //#given a multi-domain auth system request
      //#when scoring complexity
      //#then total >= 40, cross_domain true
      it("scores 'Build authentication system with frontend, backend, and database' above threshold", () => {
        const result = scoreComplexity(
          "Build authentication system with frontend, backend, and database"
        );
        expect(result.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(true);
        expect(result.concern_count).toBeGreaterThanOrEqual(3);
      });

      //#given a full e-commerce platform request
      //#when scoring complexity
      //#then total >= 40
      it("scores 'Build full e-commerce platform' above threshold", () => {
        const result = scoreComplexity("Build full e-commerce platform");
        expect(result.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD);
      });

      //#given a multi-tech stack request
      //#when scoring complexity
      //#then total >= 40, cross_domain true
      it("scores 'Build auth with frontend React, backend Express, PostgreSQL DB, Redis cache' above threshold", () => {
        const result = scoreComplexity(
          "Build auth with frontend React, backend Express, PostgreSQL DB, Redis cache"
        );
        expect(result.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(true);
      });

      //#given a full-stack request with explicit cross-domain signal
      //#when scoring complexity
      //#then total >= 40, cross_domain true
      it("scores 'full-stack application with authentication and payments' above threshold", () => {
        const result = scoreComplexity(
          "Build a full-stack application with authentication and payments"
        );
        expect(result.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(true);
      });

      //#given end-to-end system request
      //#when scoring complexity
      //#then total >= 40, cross_domain true
      it("scores 'end-to-end testing infrastructure with CI/CD pipeline' above threshold", () => {
        const result = scoreComplexity(
          "Set up end-to-end testing infrastructure with CI/CD pipeline and Docker"
        );
        expect(result.total).toBeGreaterThanOrEqual(DECOMPOSITION_THRESHOLD);
        expect(result.cross_domain).toBe(true);
      });
    });

    describe("return shape", () => {
      //#given any request
      //#when scoring complexity
      //#then returns ComplexityScore with all required fields
      it("returns valid ComplexityScore shape", () => {
        const result = scoreComplexity("Any request");
        expect(result).toHaveProperty("total");
        expect(result).toHaveProperty("concern_count");
        expect(result).toHaveProperty("file_count_estimate");
        expect(result).toHaveProperty("cross_domain");
        expect(result).toHaveProperty("reasoning");
        expect(typeof result.total).toBe("number");
        expect(typeof result.concern_count).toBe("number");
        expect(typeof result.file_count_estimate).toBe("number");
        expect(typeof result.cross_domain).toBe("boolean");
        expect(typeof result.reasoning).toBe("string");
      });

      //#given any request
      //#when scoring complexity
      //#then total is 0-100
      it("clamps total score between 0 and 100", () => {
        const simple = scoreComplexity("fix typo");
        expect(simple.total).toBeGreaterThanOrEqual(0);
        expect(simple.total).toBeLessThanOrEqual(100);

        const complex = scoreComplexity(
          "Build full-stack e-commerce platform with auth, payments, frontend React, backend Node, PostgreSQL database, Redis cache, Docker infrastructure, CI/CD pipeline, monitoring, logging"
        );
        expect(complex.total).toBeGreaterThanOrEqual(0);
        expect(complex.total).toBeLessThanOrEqual(100);
      });

      //#given any request
      //#when scoring complexity
      //#then reasoning is non-empty
      it("always provides non-empty reasoning", () => {
        const result = scoreComplexity("Fix typo");
        expect(result.reasoning.length).toBeGreaterThan(0);
      });

      //#given any request
      //#when scoring complexity
      //#then concern_count >= 0
      it("concern_count is non-negative", () => {
        const result = scoreComplexity("Fix typo");
        expect(result.concern_count).toBeGreaterThanOrEqual(0);
      });

      //#given any request
      //#when scoring complexity
      //#then file_count_estimate >= 1
      it("file_count_estimate is at least 1", () => {
        const result = scoreComplexity("Fix typo");
        expect(result.file_count_estimate).toBeGreaterThanOrEqual(1);
      });
    });

    describe("determinism", () => {
      //#given same input
      //#when scoring twice
      //#then identical output
      it("produces identical results for same input", () => {
        const input = "Build authentication system with React frontend and Express backend";
        const first = scoreComplexity(input);
        const second = scoreComplexity(input);
        expect(first).toEqual(second);
      });

      //#given same input with different casing
      //#when scoring
      //#then same score (case-insensitive matching)
      it("is case-insensitive for keyword matching", () => {
        const lower = scoreComplexity("build frontend and backend and database");
        const upper = scoreComplexity("Build Frontend and Backend and Database");
        expect(lower.total).toBe(upper.total);
        expect(lower.concern_count).toBe(upper.concern_count);
      });
    });

    describe("concern detection", () => {
      //#given request mentioning auth domain
      //#when scoring
      //#then detects auth concern
      it("detects auth-related concerns", () => {
        const result = scoreComplexity("Add JWT authentication with OAuth2 login");
        expect(result.concern_count).toBeGreaterThanOrEqual(1);
      });

      //#given request mentioning frontend domain
      //#when scoring
      //#then detects frontend concern
      it("detects frontend concerns", () => {
        const result = scoreComplexity("Build React component with responsive CSS layout");
        expect(result.concern_count).toBeGreaterThanOrEqual(1);
      });

      //#given request mentioning backend domain
      //#when scoring
      //#then detects backend concern
      it("detects backend concerns", () => {
        const result = scoreComplexity("Create Express API endpoints with middleware");
        expect(result.concern_count).toBeGreaterThanOrEqual(1);
      });

      //#given request mentioning database domain
      //#when scoring
      //#then detects database concern
      it("detects database concerns", () => {
        const result = scoreComplexity("Design PostgreSQL schema with migrations");
        expect(result.concern_count).toBeGreaterThanOrEqual(1);
      });

      //#given request mentioning infrastructure domain
      //#when scoring
      //#then detects infra concern
      it("detects infrastructure concerns", () => {
        const result = scoreComplexity("Set up Docker containers with Kubernetes deployment");
        expect(result.concern_count).toBeGreaterThanOrEqual(1);
      });
    });

    describe("cross-domain detection", () => {
      //#given request with explicit "full-stack" signal
      //#when scoring
      //#then cross_domain is true
      it("detects 'full-stack' as cross-domain signal", () => {
        const result = scoreComplexity("Build a full-stack web application");
        expect(result.cross_domain).toBe(true);
      });

      //#given request with "end-to-end" signal
      //#when scoring
      //#then cross_domain is true
      it("detects 'end-to-end' as cross-domain signal", () => {
        const result = scoreComplexity("Implement end-to-end user flow");
        expect(result.cross_domain).toBe(true);
      });

      //#given request spanning 3+ domains
      //#when scoring
      //#then cross_domain is true
      it("sets cross_domain when 3+ domains detected", () => {
        const result = scoreComplexity(
          "Build auth backend with React frontend and PostgreSQL database"
        );
        expect(result.cross_domain).toBe(true);
        expect(result.concern_count).toBeGreaterThanOrEqual(3);
      });

      //#given single-domain request
      //#when scoring
      //#then cross_domain is false
      it("cross_domain false for single-domain tasks", () => {
        const result = scoreComplexity("Fix CSS styling on the button");
        expect(result.cross_domain).toBe(false);
      });
    });

    describe("file count estimation", () => {
      //#given a simple single-concern task
      //#when scoring
      //#then low file estimate
      it("estimates few files for simple tasks", () => {
        const result = scoreComplexity("Fix typo in login button");
        expect(result.file_count_estimate).toBeLessThanOrEqual(3);
      });

      //#given a multi-domain complex task
      //#when scoring
      //#then higher file estimate
      it("estimates more files for complex tasks", () => {
        const result = scoreComplexity(
          "Build auth with frontend React, backend Express, PostgreSQL DB"
        );
        expect(result.file_count_estimate).toBeGreaterThan(3);
      });
    });

    describe("with project context", () => {
      //#given a request with project context mentioning monorepo
      //#when scoring
      //#then score may be boosted
      it("considers project context in scoring", () => {
        const withoutCtx = scoreComplexity("Add user registration");
        const withCtx = scoreComplexity(
          "Add user registration",
          "monorepo with frontend, backend, and shared packages"
        );
        expect(withCtx.total).toBeGreaterThanOrEqual(withoutCtx.total);
      });

      //#given a request with no project context
      //#when scoring
      //#then still returns valid score
      it("works without project context", () => {
        const result = scoreComplexity("Build a feature");
        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(result.total).toBeLessThanOrEqual(100);
      });
    });

    describe("edge cases", () => {
      //#given empty string
      //#when scoring
      //#then returns minimal score
      it("handles empty string", () => {
        const result = scoreComplexity("");
        expect(result.total).toBe(0);
        expect(result.concern_count).toBe(0);
        expect(result.cross_domain).toBe(false);
      });

      //#given very long input
      //#when scoring
      //#then still returns valid clamped score
      it("handles very long input", () => {
        const longInput = "Build " + "a full-stack system with auth database frontend backend infra ".repeat(50);
        const result = scoreComplexity(longInput);
        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(result.total).toBeLessThanOrEqual(100);
      });

      //#given gibberish input
      //#when scoring
      //#then returns low score
      it("handles gibberish", () => {
        const result = scoreComplexity("asdf qwerty zxcv 12345");
        expect(result.total).toBeLessThan(DECOMPOSITION_THRESHOLD);
      });
    });
  });
});
