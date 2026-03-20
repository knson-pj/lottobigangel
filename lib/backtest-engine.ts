import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  DEFAULT_COMBO_COUNT,
  DEFAULT_TOP_POOL_SIZE,
  buildCombos,
  type PredictionCombo,
  type PredictionNumberScore,
} from "@/lib/prediction-engine";

export type BacktestRoundResult = {
  actualRound: number;
  actualNumbers: number[];
  topHits: number;
  bonusIncludedInTopPool: boolean;
  maxComboHit: number;
  comboResults: Array<{
    comboRank: number;
    numbers: number[];
    hitCount: number;
  }>;
  top24Sorted: number[];
};

export type BacktestSummary = {
  evaluatedRounds: number;
  averageTopHits: number;
  roundsWith4PlusTopHits: number;
  roundsWith5PlusTopHits: number;
  averageMaxComboHit: number;
  roundsWith4PlusComboHit: number;
  roundsWith5PlusComboHit: number;
};

export type BacktestResult = {
  targetRange: {
    fromRound: number;
    toRound: number;
  };
  topPoolSize: number;
  comboCount: number;
  modelVersion: string;
  featureVersion: string;
  summary: BacktestSummary;
  rounds: BacktestRoundResult[];
};

type PredictionRunRow = {
  id: number;
  target_round: number;
  model_version: string;
  feature_version: string;
  top_pool_size: number | null;
  combo_count: number | null;
  created_at: string;
};

type PredictionScoreRow = {
  run_id: number;
  number: number;
  probability: number;
  rank_order: number;
};

type PredictionComboRow = {
  run_id: number;
  combo_rank: number;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  combo_score: number;
};

type DrawRow = {
  round: number;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  bonus: number;
};

function countHits(picks: number[], actualSet: Set<number>): number {
  return picks.reduce((sum, value) => sum + (actualSet.has(value) ? 1 : 0), 0);
}

function toActualNumbers(draw: DrawRow): number[] {
  return [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6].slice().sort((a, b) => a - b);
}

function summarize(rounds: BacktestRoundResult[]): BacktestSummary {
  const evaluatedRounds = rounds.length;
  const averageTopHits =
    evaluatedRounds === 0 ? 0 : rounds.reduce((sum, item) => sum + item.topHits, 0) / evaluatedRounds;
  const averageMaxComboHit =
    evaluatedRounds === 0 ? 0 : rounds.reduce((sum, item) => sum + item.maxComboHit, 0) / evaluatedRounds;

  return {
    evaluatedRounds,
    averageTopHits: Number(averageTopHits.toFixed(3)),
    roundsWith4PlusTopHits: rounds.filter((item) => item.topHits >= 4).length,
    roundsWith5PlusTopHits: rounds.filter((item) => item.topHits >= 5).length,
    averageMaxComboHit: Number(averageMaxComboHit.toFixed(3)),
    roundsWith4PlusComboHit: rounds.filter((item) => item.maxComboHit >= 4).length,
    roundsWith5PlusComboHit: rounds.filter((item) => item.maxComboHit >= 5).length,
  };
}

function groupLatestRunsByTargetRound(rows: PredictionRunRow[]): PredictionRunRow[] {
  const picked = new Map<number, PredictionRunRow>();

  for (const row of rows) {
    const current = picked.get(row.target_round);
    if (!current) {
      picked.set(row.target_round, row);
      continue;
    }

    if (row.created_at > current.created_at) {
      picked.set(row.target_round, row);
    }
  }

  return Array.from(picked.values()).sort((a, b) => b.target_round - a.target_round || (a.created_at < b.created_at ? 1 : -1));
}

function toNumberScores(rows: PredictionScoreRow[]): PredictionNumberScore[] {
  return rows
    .slice()
    .sort((a, b) => a.rank_order - b.rank_order || b.probability - a.probability || a.number - b.number)
    .map((row, index) => ({
      number: row.number,
      probability: row.probability,
      rank: Number.isFinite(row.rank_order) ? row.rank_order : index + 1,
    }));
}

function toCombosFromRows(rows: PredictionComboRow[]): PredictionCombo[] {
  return rows
    .slice()
    .sort((a, b) => a.combo_rank - b.combo_rank)
    .map((row) => ({
      rank: row.combo_rank,
      numbers: [row.n1, row.n2, row.n3, row.n4, row.n5, row.n6].sort((a, b) => a - b) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      score: row.combo_score,
    }));
}

export async function runBacktest(options?: {
  rounds?: number;
  historyWindow?: number;
  topPoolSize?: number;
  comboCount?: number;
}): Promise<BacktestResult> {
  const rounds = Math.max(1, Math.min(60, options?.rounds ?? 20));
  const topPoolSize = options?.topPoolSize ?? DEFAULT_TOP_POOL_SIZE;
  const comboCount = options?.comboCount ?? DEFAULT_COMBO_COUNT;

  const runsRes = await supabaseAdmin
    .from("prediction_runs")
    .select("id,target_round,model_version,feature_version,top_pool_size,combo_count,created_at")
    .eq("status", "completed")
    .order("target_round", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (runsRes.error) {
    throw runsRes.error;
  }

  const latestRuns = groupLatestRunsByTargetRound((runsRes.data ?? []) as PredictionRunRow[]).slice(0, rounds);
  if (latestRuns.length === 0) {
    throw new Error("no completed prediction_runs found for backtest");
  }

  const runIds = latestRuns.map((run) => run.id);
  const targetRounds = latestRuns.map((run) => run.target_round);

  const [scoresRes, combosRes, drawsRes] = await Promise.all([
    supabaseAdmin
      .from("prediction_number_scores")
      .select("run_id,number,probability,rank_order")
      .in("run_id", runIds),
    supabaseAdmin
      .from("prediction_combos")
      .select("run_id,combo_rank,n1,n2,n3,n4,n5,n6,combo_score")
      .in("run_id", runIds),
    supabaseAdmin
      .from("lotto_draws")
      .select("round,n1,n2,n3,n4,n5,n6,bonus")
      .in("round", targetRounds),
  ]);

  if (scoresRes.error) throw scoresRes.error;
  if (combosRes.error) throw combosRes.error;
  if (drawsRes.error) throw drawsRes.error;

  const scoreRows = (scoresRes.data ?? []) as PredictionScoreRow[];
  const comboRows = (combosRes.data ?? []) as PredictionComboRow[];
  const drawRows = (drawsRes.data ?? []) as DrawRow[];

  const scoresByRun = new Map<number, PredictionScoreRow[]>();
  scoreRows.forEach((row) => {
    const current = scoresByRun.get(row.run_id);
    if (current) current.push(row);
    else scoresByRun.set(row.run_id, [row]);
  });

  const combosByRun = new Map<number, PredictionComboRow[]>();
  comboRows.forEach((row) => {
    const current = combosByRun.get(row.run_id);
    if (current) current.push(row);
    else combosByRun.set(row.run_id, [row]);
  });

  const drawByRound = new Map(drawRows.map((row) => [row.round, row]));
  const evaluated: BacktestRoundResult[] = [];

  for (const run of latestRuns) {
    const actualDraw = drawByRound.get(run.target_round);
    if (!actualDraw) {
      continue;
    }

    const numberScores = toNumberScores(scoresByRun.get(run.id) ?? []);
    if (numberScores.length < 6) {
      continue;
    }

    const actualNumbers = toActualNumbers(actualDraw);
    const actualSet = new Set(actualNumbers);
    const resolvedTopPoolSize = Math.max(6, Math.min(topPoolSize, numberScores.length));

    const top24Sorted = numberScores
      .slice(0, resolvedTopPoolSize)
      .map((item) => item.number)
      .sort((a, b) => a - b);

    const savedCombos = toCombosFromRows(combosByRun.get(run.id) ?? []);
    const effectiveCombos = savedCombos.length > 0 ? savedCombos.slice(0, comboCount) : buildCombos(numberScores, resolvedTopPoolSize, comboCount);

    const comboResults = effectiveCombos.map((combo) => ({
      comboRank: combo.rank,
      numbers: combo.numbers.slice(),
      hitCount: countHits(combo.numbers, actualSet),
    }));

    evaluated.push({
      actualRound: actualDraw.round,
      actualNumbers,
      topHits: countHits(top24Sorted, actualSet),
      bonusIncludedInTopPool: top24Sorted.includes(actualDraw.bonus),
      maxComboHit: comboResults.reduce((max, item) => Math.max(max, item.hitCount), 0),
      comboResults,
      top24Sorted,
    });
  }

  if (evaluated.length === 0) {
    throw new Error("backtest produced no evaluable rounds from saved prediction_runs");
  }

  const latestRun = latestRuns[0];

  return {
    targetRange: {
      fromRound: evaluated[evaluated.length - 1].actualRound,
      toRound: evaluated[0].actualRound,
    },
    topPoolSize,
    comboCount,
    modelVersion: latestRun.model_version,
    featureVersion: latestRun.feature_version,
    summary: summarize(evaluated),
    rounds: evaluated,
  };
}
