/// <reference lib="deno.ns" />
// /supabase/functions/subscribe/index.ts
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// ====== Env (from Edge Function Secrets) ======
const PROJECT_URL = Deno.env.get("PROJECT_URL")!;                 // e.g. https://isvzhpqrmjtqnqyyidxr.supabase.co
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;       // service role key
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;     // sk_live_... 
const SUCCESS_URL = Deno.env.get("SUCCESS_URL")!;                 // e.g. https://spyconverter.com/docs/dashboard.html?success=true
const CANCEL_URL = Deno.env.get("CANCEL_URL")!;                   // e.g. https://spyconverter.com/docs/dashboard.html?cancel=true
const STRIPE_PRICE_MONTHLY = Deno.env.get("STRIPE_PRICE_MONTHLY")!;       // price_...
const STRIPE_PRICE_SIXMONTHS = Deno.env.get("STRIPE_PRICE_SIXMONTHS")!;   // price_...

// ====== SDK clients ======
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

// ====== Price map ======
const PRICE_IDS: Record<string, string> = {
  monthly: STRIPE_PRICE_MONTHLY,
  six_months: STRIPE_PRICE_SIXMONTHS,
};

// ====== CORS helper ======
function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

// ====== Handler ======
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "POST") {
    return cors(new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405 }));
  }

  try {
    // Bearer token from Supabase client session
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.split(" ")[1];
    if (!token) {
      return cors(new Response(JSON.stringify({ message: "Missing bearer token" }), { status: 401 }));
    }

    // Validate user
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return cors(new Response(JSON.stringify({ message: "Invalid token" }), { status: 401 }));
    }

    // Parse plan from body
    const { plan = "monthly" } = await req.json().catch(() => ({}));
    const priceId = PRICE_IDS[plan];
    if (!priceId) {
      return cors(new Response(JSON.stringify({ message: "Invalid plan" }), { status: 400 }));
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      metadata: { userId: user.id },
    });

    return cors(new Response(JSON.stringify({ url: session.url }), { status: 200 }));
  } catch (e) {
    console.error("subscribe error", e);
    return cors(new Response(JSON.stringify({ message: "Server error" }), { status: 500 }));
  }
});
