import { describe, it, expect } from "bun:test";
import { checkIsolation, type IsolationResult } from "./isolation-checker";

describe("isolation-checker", () => {
  describe("checkIsolation", () => {
    //#given isolated test code with no network or database calls
    //#when checkIsolation is called
    //#then it should return isolated: true with no violations
    it("should return isolated: true for clean test code", () => {
      const testContent = `
        import { describe, it, expect } from "bun:test";
        import { myFunction } from "./my-module";

        describe("myFunction", () => {
          it("should work correctly", () => {
            const result = myFunction(42);
            expect(result).toBe(84);
          });
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(true);
      expect(result.violations).toEqual([]);
    });

    //#given test code with fetch call
    //#when checkIsolation is called
    //#then it should detect fetch violation
    it("should detect fetch calls", () => {
      const testContent = `
        it("should fetch data", async () => {
          const response = await fetch("https://api.example.com/data");
          expect(response.ok).toBe(true);
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("fetch()");
    });

    //#given test code with axios usage
    //#when checkIsolation is called
    //#then it should detect axios violation
    it("should detect axios calls", () => {
      const testContent = `
        import axios from "axios";

        it("should get data", async () => {
          const response = await axios.get("https://api.example.com");
          expect(response.data).toBeDefined();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("axios");
    });

    //#given test code with http.request
    //#when checkIsolation is called
    //#then it should detect http.request violation
    it("should detect http.request calls", () => {
      const testContent = `
        import http from "http";

        it("should make request", () => {
          http.request({ hostname: "example.com" }, (res) => {});
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("http.request()");
    });

    //#given test code with https.request
    //#when checkIsolation is called
    //#then it should detect https.request violation
    it("should detect https.request calls", () => {
      const testContent = `
        import https from "https";

        it("should make secure request", () => {
          https.request({ hostname: "example.com" }, (res) => {});
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("https.request()");
    });

    //#given test code with net.connect
    //#when checkIsolation is called
    //#then it should detect net.connect violation
    it("should detect net.connect calls", () => {
      const testContent = `
        import net from "net";

        it("should connect", () => {
          const socket = net.connect(8080, "localhost");
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("net.connect()");
    });

    //#given test code with pg Client
    //#when checkIsolation is called
    //#then it should detect pg Client violation
    it("should detect pg Client instantiation", () => {
      const testContent = `
        import { Client } from "pg";

        it("should query database", async () => {
          const client = new Client();
          await client.connect();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("new Client() (pg)");
    });

    //#given test code with pg.connect
    //#when checkIsolation is called
    //#then it should detect pg.connect violation
    it("should detect pg.connect calls", () => {
      const testContent = `
        import pg from "pg";

        it("should connect to postgres", async () => {
          await pg.connect("postgres://localhost/db");
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("pg.connect()");
    });

    //#given test code with mysql.createConnection
    //#when checkIsolation is called
    //#then it should detect mysql violation
    it("should detect mysql.createConnection calls", () => {
      const testContent = `
        import mysql from "mysql";

        it("should connect to mysql", () => {
          const connection = mysql.createConnection({ host: "localhost" });
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("mysql.createConnection()");
    });

    //#given test code with MongoClient
    //#when checkIsolation is called
    //#then it should detect MongoDB violations
    it("should detect MongoClient usage", () => {
      const testContent = `
        import { MongoClient } from "mongodb";

        it("should connect to mongo", async () => {
          const client = new MongoClient("mongodb://localhost:27017");
          await client.connect();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations.some(v => v.includes("MongoClient"))).toBe(true);
    });

    //#given test code with mongoClient.connect
    //#when checkIsolation is called
    //#then it should detect mongoClient.connect violation
    it("should detect mongoClient.connect calls", () => {
      const testContent = `
        it("should connect", async () => {
          await mongoClient.connect();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("mongoClient.connect()");
    });

    //#given test code with redis.createClient
    //#when checkIsolation is called
    //#then it should detect redis violation
    it("should detect redis.createClient calls", () => {
      const testContent = `
        import redis from "redis";

        it("should connect to redis", () => {
          const client = redis.createClient();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("redis.createClient()");
    });

    //#given test code with multiple violations
    //#when checkIsolation is called
    //#then it should detect all violations
    it("should detect multiple violations", () => {
      const testContent = `
        import axios from "axios";
        import { Client } from "pg";

        it("should do many things", async () => {
          const response = await fetch("/api");
          const data = await axios.get("/data");
          const client = new Client();
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
      expect(result.violations).toContain("fetch()");
      expect(result.violations).toContain("axios");
      expect(result.violations).toContain("new Client() (pg)");
    });

    //#given test code with mocked fetch
    //#when checkIsolation is called
    //#then it should still detect fetch usage (false positive is acceptable)
    it("should detect fetch even in mock context", () => {
      const testContent = `
        import { mock } from "bun:test";

        const mockFetch = mock(() => Promise.resolve({ ok: true }));
        global.fetch = mockFetch;

        it("should use mocked fetch", async () => {
          await fetch("/api");
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
      expect(result.violations).toContain("fetch()");
    });

    //#given empty test content
    //#when checkIsolation is called
    //#then it should return isolated: true
    it("should handle empty content", () => {
      const result = checkIsolation("");

      expect(result.isolated).toBe(true);
      expect(result.violations).toEqual([]);
    });

    //#given test content with comments containing violation patterns
    //#when checkIsolation is called
    //#then it should detect them (simple regex approach)
    it("should detect patterns in comments (limitation of regex approach)", () => {
      const testContent = `
        // We use fetch() to get data
        it("should work", () => {
          expect(true).toBe(true);
        });
      `;

      const result = checkIsolation(testContent);

      expect(result.isolated).toBe(false);
    });
  });
});
