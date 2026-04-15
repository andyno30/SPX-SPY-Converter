"use client";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

let browserClient: ReturnType<typeof createClient<Database>> | null = null;

/**
 * Singleton browser client used by realtime subscriptions.
 */
export function getBrowserSupabaseClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.",
    );
  }

  browserClient = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  });

  return browserClient;
}
