import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_offline");

// Handles POST /api/stripe/webhook. Takes a web Request and the endpoint's
// signing secret, returns a web Response.
export async function handleWebhook(request, signingSecret) {
  const signature = request.headers.get("stripe-signature");
  const body = await request.json();

  const event = stripe.webhooks.constructEvent(JSON.stringify(body), signature, signingSecret);

  if (event.type === "checkout.session.completed") {
    return Response.json({ received: true, fulfilled: event.data.object.id });
  }
  return Response.json({ received: true });
}
