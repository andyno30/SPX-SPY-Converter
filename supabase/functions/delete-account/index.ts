/// <reference lib="deno.ns" />
// /supabase/functions/delete-account/index.ts
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// ====== Env (Edge Function Secrets) ======
const PROJECT_URL = Deno.env.get("PROJECT_URL")!;             // e.g. https://isvzhpqrmjtqnqyyidxr.supabase.co
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;   // service role key
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!; // sk_live_... or sk_test_...

// ====== SDK clients ======
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

// ====== CORS helper (same as others) ======
function cors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type"
  );
  headers.set("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

  // Only allow DELETE
  if (req.method !== "DELETE") {
    return cors(new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405 }));
  }

  try {
    // Auth bearer token
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.split(" ")[1];
    if (!token) {
      return cors(new Response(JSON.stringify({ message: "Missing bearer token" }), { status: 401 }));
    }

    // Validate user from token
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return cors(new Response(JSON.stringify({ message: "Invalid token" }), { status: 401 }));
    }

    // Lookup subscription_id from profiles
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("subscription_id")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      console.error("Profile fetch error:", profileErr);
    }

    // Cancel Stripe subscription if present
    if (profile?.subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.subscription_id);
      } catch (e) {
        console.error("Stripe cancel error:", e);
        // continue to delete auth user regardless
      }
    }

    // Remove profile row (optional if you use FK cascade)
    const { error: delProfileErr } = await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);
    if (delProfileErr) console.error("Profile delete error:", delProfileErr);

    // Delete auth user (admin)
    const { error: delUserErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delUserErr) {
      console.error("Auth delete error:", delUserErr);
      return cors(new Response(JSON.stringify({ message: "Failed to delete user" }), { status: 500 }));
    }

    return cors(new Response(JSON.stringify({ message: "Account and subscription deleted successfully" }), { status: 200 }));
  } catch (e) {
    console.error("delete-account error:", e);
    return cors(new Response(JSON.stringify({ message: "Server error" }), { status: 500 }));
  }
});
