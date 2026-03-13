import { NextResponse } from 'next/server'

import { assertCronAuthorized } from '@/lib/cron'
import { writeServerLog } from '@/lib/log'
import { runPrediction } from '@/lib/predict'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: Request) {
  const route = '/api/cron/daily-predict'

  try {
    assertCronAuthorized(req)

    const drawRes = await supabaseAdmin
      .from('lotto_draws')
      .select('round')
      .order('round', { ascending: false })
      .limit(1)
      .single()

    if (drawRes.error) throw drawRes.error

    const latestRound = Number(drawRes.data.round)
    const targetRound = latestRound + 1
    const modelVersion = process.env.MODEL_VERSION ?? 'tcn-v1'

    const existingRun = await supabaseAdmin
      .from('prediction_runs')
      .select('id')
      .eq('target_round', targetRound)
      .eq('model_version', modelVersion)
      .eq('triggered_by', 'cron')
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    if (existingRun.error) throw existingRun.error

    if (existingRun.data) {
      await writeServerLog({
        level: 'info',
        eventType: 'cron.daily_predict.skipped',
        route,
        targetRound,
        payload: {
          reason: 'already_exists',
          runId: existingRun.data.id
        }
      })

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'already_exists',
        runId: existingRun.data.id,
        targetRound
      })
    }

    const result = await runPrediction(targetRound)

    const runInsert = await supabaseAdmin
      .from('prediction_runs')
      .insert({
        target_round: targetRound,
        model_version: result.modelVersion,
        feature_version: result.featureVersion,
        triggered_by: 'cron',
        status: 'completed',
        top_pool_size: result.topPoolSize,
        combo_count: result.comboCount
      })
      .select('id')
      .single()

    if (runInsert.error) throw runInsert.error

    const runId = runInsert.data.id

    const numberRows = result.numberScores.map((item, idx) => ({
      run_id: runId,
      number: item.number,
      probability: item.probability,
      rank_order: idx + 1
    }))

    const comboRows = result.combos.map((combo) => ({
      run_id: runId,
      combo_rank: combo.rank,
      n1: combo.numbers[0],
      n2: combo.numbers[1],
      n3: combo.numbers[2],
      n4: combo.numbers[3],
      n5: combo.numbers[4],
      n6: combo.numbers[5],
      combo_score: combo.score,
      meta: combo.meta ?? {}
    }))

    const [numberInsert, comboInsert] = await Promise.all([
      supabaseAdmin.from('prediction_number_scores').insert(numberRows),
      supabaseAdmin.from('prediction_combos').insert(comboRows)
    ])

    if (numberInsert.error) throw numberInsert.error
    if (comboInsert.error) throw comboInsert.error

    await writeServerLog({
      level: 'info',
      eventType: 'cron.daily_predict.success',
      route,
      targetRound,
      payload: {
        runId,
        latestRound,
        comboCount: result.comboCount,
        topPoolSize: result.topPoolSize
      }
    })

    return NextResponse.json({ ok: true, runId, targetRound })
  } catch (error: any) {
    await writeServerLog({
      level: 'error',
      eventType: 'cron.daily_predict.error',
      route,
      payload: { message: error?.message ?? 'unknown error' }
    })

    return NextResponse.json({ ok: false, error: error?.message ?? 'unknown error' }, { status: 500 })
  }
}
