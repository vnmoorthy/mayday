# HivePay payout never goes through

`payout.mjs` pays a seller $49.99 to their bank account through the HivePay SDK in `sdk/`; it was written by following `docs.md`, it runs offline against the SDK's built-in sandbox, and right now every payout is refused.

Make `node check.mjs` pass by fixing `payout.mjs`. Do not edit `check.mjs` or anything under `sdk/`.
