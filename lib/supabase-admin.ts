import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cachedClient: SupabaseClient | null = null

function getRequiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is missing`)
  }
  return value
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) {
    return cachedClient
  }

  const supabaseUrl = getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  cachedClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return cachedClient
}

// 기존 코드와 호환되도록 lazy proxy 유지
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseAdmin()
    return Reflect.get(client as object, prop, receiver)
  },
})
