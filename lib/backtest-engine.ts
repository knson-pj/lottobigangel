import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  DEFAULT_COMBO_COUNT,
  DEFAULT_TOP_POOL_SIZE,
  type DrawRow,
  type PredictionCombo,
  type PredictionRunResult,
  predictFromHistoricalDraws,
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

export async function runBacktest(options?: {
  rounds?: number;
  historyWindow?: number;
  topPoolSize?: number;
  comboCount?: number;
}): Promise<BacktestResult> {
  const rounds = Math.max(1, Math.min(60, options?.rounds ?? 20));
  const historyWindow = Math.max(20, Math.min(200, options?.historyWindow ?? 80));
  const topPoolSize = options?.topPoolSize ?? DEFAULT_TOP_POOL_SIZE;
  const comboCount = options?.comboCount ?? DEFAULT_COMBO_COUNT;

  const response = await supabaseAdmin
    .from("lotto_draws")
    .select("round,draw_date,n1,n2,n3,n4,n5,n6,bonus")
    .order("round", { ascending: true });

  if (response.error) {
    throw response.error;
  }

  const draws = (response.data ?? []) as DrawRow[];
  if (draws.length < historyWindow + 1) {
    throw new Error("not enough lotto_draws rows for backtest");
  }

  const latestCandidates = draws.slice(-(rounds + historyWindow));
  const evaluated: BacktestRoundResult[] = [];
  let latestPrediction: PredictionRunResult | null = null;

  for (let index = historyWindow; index < latestCandidates.length; index += 1) {
    const actualDraw = latestCandidates[index];
    const historySlice = latestCandidates.slice(Math.max(0, index - historyWindow), index);

    if (historySlice.length < 20) {
      continue;
    }

    const prediction = predictFromHistoricalDraws(historySlice.slice().reverse(), actualDraw.round, {
      topPoolSize,
      comboCount,
    });

    latestPrediction = prediction;

    const actualNumbers = toActualNumbers(actualDraw);
    const actualSet = new Set(actualNumbers);

    const top24Sorted = prediction.numberScores
      .slice(0, topPoolSize)
      .map((item) => item.number)
      .sort((a, b) => a - b);

    const comboResults = prediction.combos.map((combo) => ({
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

  if (evaluated.length === 0 || !latestPrediction) {
    throw new Error("backtest produced no rounds");
  }

  return {
    targetRange: {
      fromRound: evaluated[0].actualRound,
      toRound: evaluated[evaluated.length - 1].actualRound,
    },
    topPoolSize,
    comboCount,
    modelVersion: latestPrediction.modelVersion,
    featureVersion: latestPrediction.featureVersion,
    summary: summarize(evaluated),
    rounds: evaluated,
  };
}
