// Server-only Supabase client (service role), lazily initialised. Lazy so that
// importing a route at BUILD time (when env may be absent) doesn't throw — the
// client is only constructed on first actual query, at runtime.
// Never import this into a client component: the service key must stay server-side.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Proxy forwards property access to the real client, built on first use.
export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const client = getClient();
    // @ts-expect-error dynamic forward
    const value = client[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
