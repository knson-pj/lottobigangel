import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const latestRun = await supabaseAdmin
    .from('prediction_runs')
    .select('*')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestRun.error) {
    return NextResponse.json({ ok: false, error: latestRun.error.message }, { status: 500 })
  }

  if (!latestRun.data) {
    return NextResponse.json({ ok: true, run: null, numbers: [], combos: [] })
  }

  const runId = latestRun.data.id

  const [numbersRes, combosRes] = await Promise.all([
    supabaseAdmin
      .from('prediction_number_scores')
      .select('*')
      .eq('run_id', runId)
      .order('rank_order', { ascending: true }),
    supabaseAdmin
      .from('prediction_combos')
      .select('*')
      .eq('run_id', runId)
      .order('combo_rank', { ascending: true })
  ])

  if (numbersRes.error) {
    return NextResponse.json({ ok: false, error: numbersRes.error.message }, { status: 500 })
  }

  if (combosRes.error) {
    return NextResponse.json({ ok: false, error: combosRes.error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    run: latestRun.data,
    numbers: numbersRes.data,
    combos: combosRes.data
  })
}
