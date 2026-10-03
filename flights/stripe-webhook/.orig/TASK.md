# Stripe webhook rejects every signed event

`webhook.mjs` is the handler for our Stripe webhook endpoint. Stripe signs each
event and the handler verifies that signature before trusting the payload.
Right now it rejects every event, including correctly signed ones.

Make `node check.mjs` pass.

Rules:

- Do not change `check.mjs`.
- Keep the signature verification: a tampered payload must still be rejected.
- Everything runs offline. No Stripe account or network access is needed.
