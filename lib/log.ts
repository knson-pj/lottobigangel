import { supabaseAdmin } from '@/lib/supabase-admin'

export async function writeServerLog(input: {
  level: 'info' | 'warn' | 'error'
  eventType: string
  requestId?: string | null
  route?: string | null
  targetRound?: number | null
  payload?: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('app_event_logs').insert({
    level: input.level,
    event_type: input.eventType,
    request_id: input.requestId ?? null,
    route: input.route ?? null,
    target_round: input.targetRound ?? null,
    payload: input.payload ?? {}
  })

  if (error) {
    console.error('writeServerLog failed', error)
  }
}
