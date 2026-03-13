import { NextResponse } from 'next/server'

import { assertCronAuthorized } from '@/lib/cron'
import { writeServerLog } from '@/lib/log'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: Request) {
  try {
    assertCronAuthorized(req)

    // TODO: 실제 로또타파 수집기로 교체
    const latestDraw = {
      round: 1214,
      draw_date: '2026-03-07',
      machine_no: 3,
      n1: 7,
      n2: 8,
      n3: 14,
      n4: 15,
      n5: 33,
      n6: 37,
      bonus: 3,
      odd_count: 3,
      even_count: 3,
      low_count: 4,
      high_count: 2,
      ac_value: 8,
      end_sum: 24,
      total_sum: 114,
      source_url: 'https://lottotapa.com/stat/result/1214'
    }

    const upsertRes = await supabaseAdmin
      .from('lotto_draws')
      .upsert(latestDraw, { onConflict: 'round' })

    if (upsertRes.error) throw upsertRes.error

    await writeServerLog({
      level: 'info',
      eventType: 'cron.sync_draws.success',
      route: '/api/cron/sync-draws',
      targetRound: latestDraw.round,
      payload: { syncedRound: latestDraw.round }
    })

    return NextResponse.json({ ok: true, syncedRound: latestDraw.round })
  } catch (error: any) {
    await writeServerLog({
      level: 'error',
      eventType: 'cron.sync_draws.error',
      route: '/api/cron/sync-draws',
      payload: { message: error?.message ?? 'unknown error' }
    })

    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown error' }, { status: 500 })
  }
}
