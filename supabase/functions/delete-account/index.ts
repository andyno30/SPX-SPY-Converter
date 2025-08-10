// /supabase/functions/delete-account/index.ts
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
    "authorization, x-client-info, apikey, content-type"
  );
  headers.set("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  // Only allow DELETE
  if (req.method !== "DELETE") {
    return cors(
      new Response(JSON.stringify({ message: "Method not allowed" }), {
        status: 405,
      })
    );
  }

  try {
    // Auth bearer token
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.split(" ")[1];
    if (!token) {
      return cors(
        new Response(JSON.stringify({ message: "Missing bearer token" }), {
          status: 401,
        })
      );
    }

    // Validate user from token
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

    // Look up subscription id on profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("subscription_id")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      console.error("Profile fetch error:", profileErr);
    }

    // Cancel subscription if present
    if (profile?.subscription_id) {
      try {
        await stripe.subscriptions.cancel(profile.subscription_id);
      } catch (e) {
        console.error("Stripe cancellation error:", e);
        // continue anyway to delete user/account
      }
    }

    // Clean up profile first (optional if you rely on FK cascade)
    const { error: delProfileErr } = await supabase
      .from("profiles")
      .delete()
      .eq("id", user.id);
    if (delProfileErr) {
      console.error("Profile delete error:", delProfileErr);
      // continue to delete auth user regardless
    }

    // Delete auth user (admin)
    const { error: delUserErr } = await supabase.auth.admin.deleteUser(user.id);
    if (delUserErr) {
      console.error("Auth delete error:", delUserErr);
      return cors(
        new Response(JSON.stringify({ message: "Failed to delete user" }), {
          status: 500,
        })
      );
    }

    return cors(
      new Response(
        JSON.stringify({ message: "Account and subscription deleted successfully" }),
        { status: 200 }
      )
    );
  } catch (e) {
    console.error("delete-account error:", e);
    return cors(
      new Response(JSON.stringify({ message: "Server error" }), { status: 500 })
    );
  }
});
