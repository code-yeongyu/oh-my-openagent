import assert from "node:assert/strict";
import { describe, test as it } from "bun:test";
import { evaluateShippedSource, findRawTlsClients } from "./no-raw-tls-client-scan";

// Security contract: regex/template trivia cannot hide raw TLS acquisitions;
// a failed parse must reject the shipped file rather than pass an empty scan.
describe("TLS guard reviewer regressions (H1/H2)", () => {

  it("detects Bun destructuring assignment", () => {
    assert.ok(findRawTlsClients("let connect; ({ connect } = Bun); connect({ tls: true });").length);
  });

  it("detects TypeScript import-equals acquisition and its call", () => {
    const hits = findRawTlsClients('import client = require("node:https"); client.get(url);');
    assert.ok(hits.some(hit => hit.text === 'import client = require("node:https")'));
    assert.ok(hits.some(hit => hit.text === "client.get(url)"));
  });

  it("detects calls independently of their module acquisition pins", () => {
    for (const [sample, call] of [
  [
    "import { default as client } from \"node:https\"; client.request(options);",
    "client.request(options)"
  ],
  [
    "import * as client from \"node:tls\"; client.connect(options);",
    "client.connect(options)"
  ],
  [
    "const client = require(\"node:https\"); client.get(url);",
    "client.get(url)"
  ],
  [
    "const { connect: dial } = await import(`node:tls`); dial(options);",
    "dial(options)"
  ],
  [
    "import client from \"https\"; const request = client.request; request(options);",
    "request(options)"
  ],
  [
    "const { default: client } = await import(\"node:https\"); client.get(url);",
    "client.get(url)"
  ]
]) {
      assert.ok(findRawTlsClients(sample).some(hit => hit.text === call), sample);
    }
  });
  it("does not interpret regex or literal text as calls", () => {
    for (const sample of ['const s = "tls.connect(o)";', 'const s = `tls.connect(o)`;', 'const r = /tls.connect\\(o\\)/;'])
      assert.deepEqual(findRawTlsClients(sample), []);
  });
  for (const sample of [
  "const r = /\"/; tls.connect(o); const s = \"x\";",
  "const r = /`/; tls.connect(o); const s = `x`;",
`const s = \`\${a ? \`"\` : ""}\`; tls.connect(o); const z = "q";`,
  "const r = /a\\/*/; tls.connect(o); /* */",
  "import { default as h } from \"node:https\"; h.request(o);",
  "export { default } from \"node:https\";",
  "export { default as h } from \"node:http2\";",
  "Bun?.connect({ tls: true });",
  "const { connect } = Bun; connect({ tls: true });",
  "const c = Bun.connect; c({ tls: true });",
  "Bun.connect.call(null, { tls: true });",
  "Bun.connect.apply(null, [{ tls: true }]);",
  "tls.createSecureContext(options);",
  "import * as network from \"node:tls\"; network.connect(o);",
  "const network = require(\"node:https\"); network.request(o);",
  "const { connect: c } = await import(`node:tls`); c(o);",
  "import { default as h } from \"node:http2\"; h.connect(o);",
  "Bun?.connect?.({ tls: true });",
  "const { connect: c } = Bun; c(o);",
  "Bun[\"connect\"].apply(null, [o]);"
]) {
    it("detects " + sample, () => assert.ok(findRawTlsClients(sample).length, sample));
  }
  it("names each malformed shipped file", () => {
    for (const content of ['const s = "unterminated', 'const s = `unterminated', 'function f() {']) {
      assert.throws(() => evaluateShippedSource([{ path: "src/broken.ts", content }], []), /src\/broken\.ts/);
    }
  });
});
