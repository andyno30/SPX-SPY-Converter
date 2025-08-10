// /supabase/functions/delete-account/index.ts
import Stripe from "npm:stripe@14.22.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function cors(res: Response) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  h.set("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (req.method !== "DELETE") return cors(new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405 }));

  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.split(" ")[1];
    if (!token) return cors(new Response(JSON.stringify({ message: "Missing bearer token" }), { status: 401 }));

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return cors(new Response(JSON.stringify({ message: "Invalid token" }), { status: 401 }));

    // Get subscription id
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("subscription_id")
      .eq("id", user.id)
      .single();

    if (!profileErr && profile?.subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.subscription_id);
      } catch (e) {
        console.error("Stripe cancel failed:", e);
        // continue to delete user anyway
      }
    }

    // Clean up profile (auth.deleteUser will cascade if you prefer)
    await supabase.from("profiles").delete().eq("id", user.id);

    // Delete user from auth
    const { error: delErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("Delete user error:", delErr);
      return cors(new Response(JSON.stringify({ message: "Failed to delete user" }), { status: 500 }));
    }

    return cors(new Response(JSON.stringify({ message: "Account and subscription deleted successfully" }), { status: 200 }));
  } catch (e) {
    console.error("delete-account error", e);
    return cors(new Response(JSON.stringify({ message: "Server error" }), { status: 500 }));
  }
});
