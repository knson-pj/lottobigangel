import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { writeServerLog } from '@/lib/log'
import { runPrediction } from '@/lib/predict'
import { supabaseAdmin } from '@/lib/supabase-admin'

const bodySchema = z.object({
  targetRound: z.number().int().positive()
})

export async function POST(req: Request) {
  const requestId = crypto.randomUUID()
  const route = '/api/predict'
  const startedAt = Date.now()

  try {
    const parsed = bodySchema.parse(await req.json())
    const result = await runPrediction(parsed.targetRound)

    const runInsert = await supabaseAdmin
      .from('prediction_runs')
      .insert({
        target_round: parsed.targetRound,
        model_version: result.modelVersion,
        feature_version: result.featureVersion,
        triggered_by: 'user',
        request_id: requestId,
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
      eventType: 'predict.success',
      requestId,
      route,
      targetRound: parsed.targetRound,
      payload: {
        durationMs: Date.now() - startedAt,
        runId
      }
    })

    return NextResponse.json({
      ok: true,
      requestId,
      runId,
      targetRound: parsed.targetRound,
      top24: result.numberScores.slice(0, 24),
      combos: result.combos
    })
  } catch (error: any) {
    await writeServerLog({
      level: 'error',
      eventType: 'predict.error',
      requestId,
      route,
      payload: {
        message: error?.message ?? 'unknown error'
      }
    })

    return NextResponse.json(
      {
        ok: false,
        requestId,
        error: error?.message ?? 'unknown error'
      },
      { status: 500 }
    )
  }
}
