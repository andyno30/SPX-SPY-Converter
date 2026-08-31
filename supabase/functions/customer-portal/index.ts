/// <reference lib="deno.ns" />
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("authorization") ?? "").split(" ")[1];
    if (!token) return json({ message: "Missing bearer token" }, 401);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ message: "Invalid token" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_customer_id,subscription_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("Profile lookup failed:", profileError);
      return json({ message: "Your billing profile could not be found." }, 404);
    }

    let customerId = profile.stripe_customer_id as string | null;
    if (!customerId && profile.subscription_id) {
      const subscription = await stripe.subscriptions.retrieve(profile.subscription_id);
      customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (updateError) console.error("Customer ID backfill failed:", updateError);
    }

    if (!customerId) {
      return json({ message: "No active billing account was found." }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: "https://spyconverter.com/docs/settings.html",
    });

    return json({ url: session.url });
  } catch (error) {
    console.error("customer-portal error:", error);
    return json({ message: "The billing portal could not be opened." }, 500);
  }
});
