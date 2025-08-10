// /supabase/functions/webhook/index.ts
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// CORS helper (same as subscribe)
function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type, stripe-signature"
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  // Only allow POST
  if (req.method !== "POST") {
    return cors(new Response("Method Not Allowed", { status: 405 }));
  }

  const sig = req.headers.get("stripe-signature");
  const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sig || !endpointSecret) {
    return cors(new Response("Missing signature/secret", { status: 400 }));
  }

  // IMPORTANT: raw body required for Stripe signature verification
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error("⚠️  Webhook signature verification failed:", (err as Error).message);
    return cors(new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 }));
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata as any)?.userId;
        const subscriptionId = session.subscription as string | null;

        if (userId) {
          const { error } = await supabase
            .from("profiles")
            .update({
              is_subscribed: true,
              subscription_id: subscriptionId ?? null,
            })
            .eq("id", userId);
          if (error) console.error("Supabase update error:", error);
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const active =
          subscription.status === "active" || subscription.status === "trialing";

        // Update by subscription_id (we set it on checkout completion)
        const { error } = await supabase
          .from("profiles")
          .update({
            is_subscribed: active,
            subscription_id: subscriptionId,
          })
          .eq("subscription_id", subscriptionId);
        if (error) console.error("Supabase subscription sync error:", error);
        break;
      }

      default:
        // Intentionally ignore other events
        break;
    }

    return cors(new Response("ok", { status: 200 }));
  } catch (e) {
    console.error("Webhook handler error:", e);
    return cors(new Response("Webhook handler error", { status: 500 }));
  }
});

