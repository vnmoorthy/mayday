# HivePay Node SDK: Payouts

_Payouts guide · SDK 3.x · last reviewed March 2025_

HivePay moves money from your platform balance to your sellers. This guide
covers the one call most integrations need: creating a payout to a seller's
bank account.

## Setup

```js
import { createClient } from "./sdk/hivepay.mjs";

const hivepay = createClient({ apiKey: process.env.HIVEPAY_API_KEY });
```

Keys that start with `hp_test_` run against the sandbox that ships inside the
SDK. Sandbox payouts settle instantly and never touch the network, so you can
develop and run tests offline. Keys that start with `hp_live_` move real money.

## Create a payout

```js
const payout = await hivepay.payouts.create(
  {
    amount: 49.99,
    currency: "usd",
    destination: "ba_tok_8f2c41d7a9",
    metadata: { reference: "October marketplace payout, seller 8841" },
  },
  { idempotencyKey: "idem-123" },
);

console.log(payout.id, payout.status); // po_3b9f0c1e2a7d4e65 paid
```

### Parameters

| Field | Type | Description |
|---|---|---|
| `amount` | number | The amount to pay out, in the currency below. `49.99` pays out forty-nine dollars and ninety-nine cents. |
| `currency` | string | Three-letter ISO currency code, lowercase. |
| `destination` | string | The bank account token for the seller, returned when the seller links an account (`ba_tok_...`). |
| `metadata` | object | Optional. Free-form details stored with the payout. `metadata.reference` is printed on the seller's bank statement. |

### Options

| Field | Type | Description |
|---|---|---|
| `idempotencyKey` | string | Any unique string you choose, for example `"idem-123"`. Retrying a request with the same key returns the original payout instead of paying twice. |

### Response

```json
{
  "id": "po_3b9f0c1e2a7d4e65",
  "status": "paid",
  "amount": 49.99,
  "currency": "usd"
}
```

`status` is `paid` once the payout has been accepted by the receiving bank.

## Idempotency

Always send an idempotency key with a payout. Network failures happen, and a
retry without a key can pay a seller twice. A common pattern is to derive the
key from your own order or payout record, such as `"idem-" + order.id`.

## Errors

Every failed call throws a `HivePayError`. The message names the problem, and
the error carries three fields you can log or branch on:

| Field | Description |
|---|---|
| `code` | A stable identifier for the failure, such as `HP_AUTH_INVALID` or `HP_RATE_LIMITED`. |
| `statusCode` | The HTTP status the API answered with. |
| `requestId` | Quote this when you contact support. |

```js
try {
  await hivepay.payouts.create(params, options);
} catch (err) {
  if (err.code === "HP_BALANCE_INSUFFICIENT") {
    // top up the platform balance and try again
  }
  throw err;
}
```

Common codes:

| Code | Meaning |
|---|---|
| `HP_AUTH_MISSING` | No API key was passed to `createClient`. |
| `HP_AUTH_INVALID` | The API key is not valid. |
| `HP_RATE_LIMITED` | Too many requests. Back off and retry. |
| `HP_BALANCE_INSUFFICIENT` | The platform balance is too low for this payout. |
| `HP_NOT_FOUND` | No such resource. |

## Retrieve a payout

```js
const payout = await hivepay.payouts.retrieve("po_3b9f0c1e2a7d4e65");
```
