// /supabase/functions/subscribe/index.ts
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// Initialize Stripe
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

// Initialize Supabase client with service role
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Your Stripe price IDs
const PRICE_IDS: Record<string, string> = {
  monthly: "price_1R8cFp2mY7zktgIWDmDVEhZA",
  six_months: "price_1R8cFp2mY7zktgIWS8YzDrb7",
};

// CORS helper
function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type"
  );
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

// Main handler
Deno.serve(async (req) => {
  // Handle preflight request
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  // Only allow POST
  if (req.method !== "POST") {
    return cors(
      new Response(JSON.stringify({ message: "Method not allowed" }), {
        status: 405,
      })
    );
  }

  try {
    // Get auth bearer token
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.split(" ")[1];
    if (!token) {
      return cors(
        new Response(JSON.stringify({ message: "Missing bearer token" }), {
          status: 401,
        })
      );
    }

    // Validate user
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return cors(
        new Response(JSON.stringify({ message: "Invalid token" }), {
          status: 401,
        })
      );
    }

    // Parse plan
    const { plan = "monthly" } = await req.json().catch(() => ({}));
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return cors(
        new Response(JSON.stringify({ message: "Invalid plan" }), {
          status: 400,
        })
      );
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: Deno.env.get("SUCCESS_URL")!,
      cancel_url: Deno.env.get("CANCEL_URL")!,
      metadata: { userId: user.id },
    });

    return cors(
      new Response(JSON.stringify({ url: session.url }), { status: 200 })
    );
  } catch (e) {
    console.error("subscribe error", e);
    return cors(
      new Response(JSON.stringify({ message: "Server error" }), {
        status: 500,
      })
    );
  }
});
