# Report contract fixture

These two files are byte-identical copies of the service report schema and its zero-dependency readers. The repository revision and SHA-256 receipts are in provenance.json. They are test inputs only, never shipped as runtime code.

The contract test validates the client-built JSON with the actual server schema, and validates content length and the SHA-256 header over the exact UTF-8 body. Both signed-in and anonymous requests are covered.

For a drift check against a service checkout, run:

    OMO_SERVICE_CONTRACT_SOURCE=/path/to/omo-service/packages/contract/src bun test packages/omo-senpi/src/components/feedback/submit.contract.test.ts

The check compares both upstream files to the pinned receipts. Updating the pin requires copying both upstream files unchanged and updating the receipt revision and hashes together, then rerunning the contract test. Ordinary test runs verify the snapshot receipts without requiring network access or a second checkout.
