import { getLatestModelProbabilitySnapshot } from "@/lib/model-probability-exports";
import {
  getPredictionForRound,
  type PredictionNumber,
  type PredictionSnapshot,
} from "@/lib/predict";

export type DrawRow = {
  round: number;
  draw_date?: string;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
  n6: number;
  bonus: number;
};

export type PredictionNumberScore = {
  number: number;
  probability: number;
  rank: number;
  extra?: Record<string, unknown>;
};

export type PredictionCombo = {
  rank: number;
  numbers: [number, number, number, number, number, number];
  score: number;
  meta?: Record<string, unknown>;
};

export type PredictionRunResult = {
  targetRound: number;
  modelVersion: string;
  featureVersion: string;
  topPoolSize: number;
  comboCount: number;
  numberScores: PredictionNumberScore[];
  combos: PredictionCombo[];
};

export type PredictionInferenceSourceKind = "public_snapshot" | "model_probability_exports";

export const CURRENT_MODEL_VERSION = process.env.MODEL_VERSION ?? "dl-inference";
export const CURRENT_FEATURE_VERSION = process.env.FEATURE_VERSION ?? "dl-snapshot";
export const DEFAULT_TOP_POOL_SIZE = 24;
export const DEFAULT_COMBO_COUNT = 5;

function uniqueSorted(numbers: number[]): [number, number, number, number, number, number] {
  const sorted = Array.from(new Set(numbers)).sort((a, b) => a - b);
  if (sorted.length !== 6) {
    throw new Error(`combo numbers must contain 6 unique values: ${numbers.join(",")}`);
  }
  return sorted as [number, number, number, number, number, number];
}

function sortNumberScores(scores: PredictionNumberScore[]): PredictionNumberScore[] {
  return scores
    .slice()
    .sort((a, b) => a.rank - b.rank || b.probability - a.probability || a.number - b.number)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
}

export function toPredictionNumberScores(snapshot: PredictionSnapshot): PredictionNumberScore[] {
  const normalized = snapshot.prediction.numbers
    .map((item: PredictionNumber) => ({
      number: item.number,
      probability: item.probability,
      rank: item.rank,
      extra: {
        ...(item.extra ?? {}),
        ...(item.recentWindow !== undefined ? { recentWindow: item.recentWindow } : {}),
        ...(item.calibrated !== undefined ? { calibrated: item.calibrated } : {}),
      },
    }))
    .filter((item) => Number.isFinite(item.number) && Number.isFinite(item.probability) && Number.isFinite(item.rank));

  if (normalized.length === 0) {
    throw new Error("prediction snapshot contains no valid number scores");
  }

  return sortNumberScores(normalized);
}

function createRankBuckets(numberScores: PredictionNumberScore[], topPoolSize: number): PredictionNumberScore[][] {
  const topPool = sortNumberScores(numberScores).slice(0, Math.max(6, topPoolSize));
  if (topPool.length < 6) {
    throw new Error("prediction snapshot must contain at least 6 ranked numbers");
  }

  const buckets = Array.from({ length: 6 }, () => [] as PredictionNumberScore[]);
  topPool.forEach((item, index) => {
    buckets[index % 6].push(item);
  });

  if (buckets.some((bucket) => bucket.length === 0)) {
    throw new Error("failed to build rank buckets from prediction scores");
  }

  return buckets;
}

function comboKey(numbers: readonly number[]): string {
  return numbers.slice().sort((a, b) => a - b).join("-");
}

export function buildCombos(
  numberScores: PredictionNumberScore[],
  topPoolSize = DEFAULT_TOP_POOL_SIZE,
  comboCount = DEFAULT_COMBO_COUNT,
): PredictionCombo[] {
  const resolvedTopPoolSize = Math.max(6, Math.min(topPoolSize, numberScores.length));
  const resolvedComboCount = Math.max(1, comboCount);
  const buckets = createRankBuckets(numberScores, resolvedTopPoolSize);
  const scoreMap = new Map(numberScores.map((item) => [item.number, item.probability]));
  const combos: PredictionCombo[] = [];
  const seen = new Set<string>();

  let seed = 0;
  const maxAttempts = Math.max(resolvedComboCount * 18, 36);

  while (combos.length < resolvedComboCount && seed < maxAttempts) {
    const picked = buckets.map((bucket, bucketIndex) => bucket[(seed + bucketIndex) % bucket.length]);
    const numbers = uniqueSorted(picked.map((item) => item.number));
    const key = comboKey(numbers);

    if (!seen.has(key)) {
      seen.add(key);
      combos.push({
        rank: combos.length + 1,
        numbers,
        score: Number(
          numbers.reduce((sum, value) => sum + (scoreMap.get(value) ?? 0), 0).toFixed(12),
        ),
        meta: {
          source: "dl-ranking-postprocess",
          topPoolSize: resolvedTopPoolSize,
          bucketRanks: picked.map((item) => item.rank),
          bucketNumbers: picked.map((item) => item.number),
        },
      });
    }

    seed += 1;
  }

  if (combos.length === 0) {
    throw new Error("failed to generate combos from prediction scores");
  }

  return combos;
}

export async function resolvePredictionSnapshot(
  targetRound: number,
): Promise<{ snapshot: PredictionSnapshot; sourceKind: PredictionInferenceSourceKind }> {
  const publicSnapshot = await getPredictionForRound(targetRound);
  if (publicSnapshot) {
    return {
      snapshot: publicSnapshot,
      sourceKind: "public_snapshot",
    };
  }

  const supabaseSnapshot = await getLatestModelProbabilitySnapshot(targetRound);
  if (supabaseSnapshot?.prediction.targetRound === targetRound) {
    return {
      snapshot: supabaseSnapshot,
      sourceKind: "model_probability_exports",
    };
  }

  throw new Error(
    `deep-learning prediction snapshot for round ${targetRound} not found. ` +
      `Generate public/prediction_snapshot.json or publish model_probability_exports first.`,
  );
}

export function buildPredictionRunResultFromSnapshot(
  snapshot: PredictionSnapshot,
  sourceKind: PredictionInferenceSourceKind,
  options?: {
    topPoolSize?: number;
    comboCount?: number;
    modelVersion?: string;
    featureVersion?: string;
  },
): PredictionRunResult {
  const numberScores = toPredictionNumberScores(snapshot);
  const resolvedTopPoolSize = Math.max(6, Math.min(options?.topPoolSize ?? DEFAULT_TOP_POOL_SIZE, numberScores.length));
  const resolvedComboCount = Math.max(1, options?.comboCount ?? DEFAULT_COMBO_COUNT);
  const combos = buildCombos(numberScores, resolvedTopPoolSize, resolvedComboCount);

  return {
    targetRound: snapshot.prediction.targetRound,
    modelVersion: options?.modelVersion ?? snapshot.prediction.modelVersion ?? CURRENT_MODEL_VERSION,
    featureVersion: options?.featureVersion ?? snapshot.prediction.featureVersion ?? CURRENT_FEATURE_VERSION,
    topPoolSize: resolvedTopPoolSize,
    comboCount: resolvedComboCount,
    numberScores: numberScores.map((item) => ({
      ...item,
      extra: {
        ...(item.extra ?? {}),
        sourceKind,
      },
    })),
    combos: combos.map((combo) => ({
      ...combo,
      meta: {
        ...(combo.meta ?? {}),
        inferenceSource: sourceKind,
      },
    })),
  };
}

export async function runPrediction(
  targetRound: number,
  options?: {
    topPoolSize?: number;
    comboCount?: number;
  },
): Promise<PredictionRunResult> {
  const { snapshot, sourceKind } = await resolvePredictionSnapshot(targetRound);
  return buildPredictionRunResultFromSnapshot(snapshot, sourceKind, options);
}
