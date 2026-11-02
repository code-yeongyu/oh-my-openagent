# Report contract fixture

These files are byte-identical copies of the service contract (`packages/contract/src` in the service repository): the report schema (`reports.ts`), its zero-dependency readers (`schema.ts`), and the closed error-code list with each code's HTTP status (`errors.ts`, kept as `errors.ts.txt` because it imports contract modules that are not copied here; the test reads it as text). The repository revision and SHA-256 receipts are in provenance.json. They are test inputs only, never shipped as runtime code.

The contract test validates the client-built JSON with the actual server schema, validates content length and the SHA-256 header over the exact UTF-8 body, and answers the client with every service error code at its own status to prove each one becomes a typed refusal. Both signed-in and anonymous requests are covered.

For a drift check against a service checkout, run:

    OMO_SERVICE_CONTRACT_SOURCE=/path/to/omo-service/packages/contract/src bun test packages/omo-senpi/src/components/feedback/submit.contract.test.ts

The check compares every upstream file to the pinned receipts. Updating the pin requires copying the upstream files unchanged and updating the receipt revision and hashes together, then rerunning the contract test. Ordinary test runs verify the snapshot receipts without requiring network access or a second checkout.
