import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseServiceConfig = {
  url: string;
  serviceRoleKey: string;
};

type SupabaseAnonConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseServiceConfig(): SupabaseServiceConfig | undefined {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return undefined;
  return { url, serviceRoleKey };
}

export function supabaseServiceConfigured(): boolean {
  return Boolean(getSupabaseServiceConfig());
}

export function createSupabaseServiceClient(): SupabaseClient | undefined {
  const config = getSupabaseServiceConfig();
  if (!config) return undefined;

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getSupabaseAnonConfig(): SupabaseAnonConfig | undefined {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  return { url, anonKey };
}

export function createSupabaseAnonClient(): SupabaseClient | undefined {
  const config = getSupabaseAnonConfig();
  if (!config) return undefined;

  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
