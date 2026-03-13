import { NextResponse } from 'next/server'

import { assertCronAuthorized } from '@/lib/cron'
import { writeServerLog } from '@/lib/log'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncLatestWithDerivedFeatures } from '@/lib/lottotapa-sync'

export async function GET(req: Request) {
  const route = '/api/cron/sync-draws'

  try {
    assertCronAuthorized(req)

    const result = await syncLatestWithDerivedFeatures(async (round) => {
      const previousRound = round - 1
      if (previousRound <= 0) return []

      const prev = await supabaseAdmin
        .from('lotto_draws')
        .select('n1,n2,n3,n4,n5,n6')
        .eq('round', previousRound)
        .maybeSingle()

      if (prev.error) throw prev.error
      if (!prev.data) return []

      return [prev.data.n1, prev.data.n2, prev.data.n3, prev.data.n4, prev.data.n5, prev.data.n6]
        .map(Number)
        .sort((a, b) => a - b)
    })

    const drawUpsert = await supabaseAdmin.from('lotto_draws').upsert(result.draw, { onConflict: 'round' })
    if (drawUpsert.error) throw drawUpsert.error

    const featureUpsert = await supabaseAdmin
      .from('lotto_draw_features')
      .upsert(result.features, { onConflict: 'round' })

    if (featureUpsert.error) throw featureUpsert.error

    await writeServerLog({
      level: 'info',
      eventType: 'cron.sync_draws.success',
      route,
      targetRound: result.latestRound,
      payload: {
        syncedRound: result.latestRound,
        drawDate: result.draw.draw_date,
        numbers: [result.draw.n1, result.draw.n2, result.draw.n3, result.draw.n4, result.draw.n5, result.draw.n6],
        bonus: result.draw.bonus
      }
    })

    return NextResponse.json({
      ok: true,
      syncedRound: result.latestRound,
      draw: result.draw,
      features: result.features
    })
  } catch (error: any) {
    await writeServerLog({
      level: 'error',
      eventType: 'cron.sync_draws.error',
      route,
      payload: {
        message: error?.message ?? 'unknown error'
      }
    })

    return NextResponse.json(
      { ok: false, error: error?.message ?? 'unknown error' },
      { status: 500 }
    )
  }
}
