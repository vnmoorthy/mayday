// HivePay Node SDK 3.x (sandbox build). HivePay is a fictional vendor: it
// exists so that a test flight can run on an API no model was trained on.
//
// payouts.create() checks its input the way a real payments API does: one
// rule at a time, in order, and each refusal only tells you about the first
// thing that is wrong. The published docs (docs.md) predate four of these
// rules, so code written from the docs is refused four times over.

import { randomBytes } from "node:crypto";

export class HivePayError extends Error {
  constructor(code, message, param) {
    super(`HivePayError [${code}]: ${message}`);
    this.name = "HivePayError";
    this.code = code;
    this.param = param;
    this.statusCode = 400;
    this.requestId = `req_${randomBytes(8).toString("hex")}`;
  }
}

const refuse = (code, message, param) => {
  throw new HivePayError(code, message, param);
};

// The rules, in the order the API applies them.
function validate(params = {}, options = {}) {
  const { amount, currency, destination, metadata } = params;

  // 1. Amounts are integers in minor units since 3.0 (the docs still show 49.99).
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    refuse("HP_AMOUNT_MINOR_UNITS", "amount must be an integer number of minor units", "amount");
  }
  if (typeof currency !== "string" || !/^[a-z]{3}$/.test(currency)) {
    refuse("HP_CURRENCY", "currency must be a lowercase three-letter ISO code", "currency");
  }

  // 2. Idempotency keys have a fixed shape since 3.1.
  const key = options.idempotencyKey;
  if (typeof key !== "string" || key.length === 0) {
    refuse("HP_IDEMPOTENCY_FORMAT", "idempotency key is required", "idempotencyKey");
  }
  if (!key.startsWith("hp_")) {
    refuse("HP_IDEMPOTENCY_FORMAT", "idempotency key is malformed: it must start with hp_", "idempotencyKey");
  }
  if (!/^hp_[0-9a-f]{24}$/.test(key)) {
    refuse(
      "HP_IDEMPOTENCY_FORMAT",
      "idempotency key is malformed: expected 24 lowercase hexadecimal characters after hp_",
      "idempotencyKey",
    );
  }

  // 3. Destinations are typed objects since 3.2 (the docs still pass the bare token).
  if (typeof destination !== "object" || destination === null) {
    refuse("HP_DESTINATION_SHAPE", "destination is not a valid destination: expected an object", "destination");
  }
  if (destination.type !== "bank_account") {
    refuse("HP_DESTINATION_SHAPE", 'destination.type is required and must be "bank_account"', "destination.type");
  }
  if (typeof destination.token !== "string" || !destination.token.startsWith("ba_tok_")) {
    refuse("HP_DESTINATION_SHAPE", "destination.token is required (a ba_tok_ bank account token)", "destination.token");
  }

  // 4. The receiving bank prints the reference on a statement line.
  const reference = metadata?.reference;
  if (typeof reference !== "string" || reference.length === 0) {
    refuse("HP_REFERENCE_LENGTH", "metadata.reference is required by the receiving bank", "metadata.reference");
  }
  if (reference.length > 18) {
    refuse(
      "HP_REFERENCE_LENGTH",
      `reference rejected by the receiving bank: ${reference.length} characters, the statement line holds 18`,
      "metadata.reference",
    );
  }
}

export function createClient({ apiKey } = {}) {
  if (typeof apiKey !== "string" || !apiKey.startsWith("hp_")) {
    throw new HivePayError("HP_API_KEY", "a HivePay API key is required (hp_test_ or hp_live_)", "apiKey");
  }
  return {
    payouts: {
      async create(params, options) {
        validate(params, options);
        return {
          id: `po_${randomBytes(8).toString("hex")}`,
          status: "paid",
          amount: params.amount,
          currency: params.currency,
        };
      },
    },
  };
}
