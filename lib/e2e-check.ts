import { getPredictionSnapshot, getPredictionSummary } from "@/lib/predict";
import { getLatestModelProbabilitySnapshot } from "@/lib/model-probability-exports";
import { runPrediction } from "@/lib/prediction-engine";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type E2ECheckResult = {
  checkedAt: string;
  latestDrawRound: number | null;
  nextTargetRound: number | null;
  tables: {
    lottoDrawsCount: number | null;
    predictionRunsCount: number | null;
    modelProbabilityExportsCount: number | null;
  };
  dryRun: {
    ok: boolean;
    targetRound: number | null;
    modelVersion?: string;
    featureVersion?: string;
    topPoolSize?: number;
    comboCount?: number;
    top24Sorted?: number[];
    inferenceSource?: string;
    error?: string;
  };
  snapshotSources: {
    supabaseLatest: {
      ok: boolean;
      targetRound?: number;
      modelVersion?: string;
      featureVersion?: string;
      candidateCount?: number;
      generatedAt?: string;
      error?: string;
    };
    publicFile: {
      ok: boolean;
      targetRound?: number;
      modelVersion?: string;
      featureVersion?: string;
      candidateCount?: number;
      generatedAt?: string;
      error?: string;
    };
  };
};

async function getTableCount(table: string): Promise<number | null> {
  const response = await supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (response.error) {
    throw response.error;
  }
  return response.count ?? 0;
}

export async function runE2ECheck(): Promise<E2ECheckResult> {
  const checkedAt = new Date().toISOString();

  const [lottoDrawsCount, predictionRunsCount, modelProbabilityExportsCount, latestDrawRes] = await Promise.all([
    getTableCount("lotto_draws"),
    getTableCount("prediction_runs"),
    getTableCount("model_probability_exports"),
    supabaseAdmin.from("lotto_draws").select("round").order("round", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (latestDrawRes.error) {
    throw latestDrawRes.error;
  }

  const latestDrawRound = latestDrawRes.data?.round ?? null;
  const nextTargetRound = typeof latestDrawRound === "number" ? latestDrawRound + 1 : null;

  let dryRun: E2ECheckResult["dryRun"] = {
    ok: false,
    targetRound: nextTargetRound,
  };

  try {
    if (typeof nextTargetRound !== "number") {
      throw new Error("latest draw round not found");
    }

    const result = await runPrediction(nextTargetRound);

    dryRun = {
      ok: true,
      targetRound: result.targetRound,
      modelVersion: result.modelVersion,
      featureVersion: result.featureVersion,
      topPoolSize: result.topPoolSize,
      comboCount: result.comboCount,
      top24Sorted: result.numberScores
        .slice(0, result.topPoolSize)
        .map((item) => item.number)
        .sort((a, b) => a - b),
      inferenceSource: String(result.numberScores[0]?.extra?.sourceKind ?? "unknown"),
    };
  } catch (error: any) {
    dryRun = {
      ok: false,
      targetRound: nextTargetRound,
      error: error?.message ?? "unknown error",
    };
  }

  let supabaseLatest: E2ECheckResult["snapshotSources"]["supabaseLatest"] = {
    ok: false,
    error: "not checked",
  };

  try {
    const snapshot = await getLatestModelProbabilitySnapshot();
    if (!snapshot) {
      supabaseLatest = {
        ok: false,
        error: "no rows found in model_probability_exports",
      };
    } else {
      const summary = getPredictionSummary(snapshot);
      supabaseLatest = {
        ok: true,
        targetRound: summary.targetRound,
        modelVersion: summary.modelVersion,
        featureVersion: summary.featureVersion,
        candidateCount: summary.candidateCount,
        generatedAt: summary.generatedAt,
      };
    }
  } catch (error: any) {
    supabaseLatest = {
      ok: false,
      error: error?.message ?? "unknown error",
    };
  }

  let publicFile: E2ECheckResult["snapshotSources"]["publicFile"] = {
    ok: false,
    error: "not checked",
  };

  try {
    const snapshot = await getPredictionSnapshot();
    if (!snapshot) {
      publicFile = {
        ok: false,
        error: "public/prediction_snapshot.json not found or invalid",
      };
    } else {
      const summary = getPredictionSummary(snapshot);
      publicFile = {
        ok: true,
        targetRound: summary.targetRound,
        modelVersion: summary.modelVersion,
        featureVersion: summary.featureVersion,
        candidateCount: summary.candidateCount,
        generatedAt: summary.generatedAt,
      };
    }
  } catch (error: any) {
    publicFile = {
      ok: false,
      error: error?.message ?? "unknown error",
    };
  }

  return {
    checkedAt,
    latestDrawRound,
    nextTargetRound,
    tables: {
      lottoDrawsCount,
      predictionRunsCount,
      modelProbabilityExportsCount,
    },
    dryRun,
    snapshotSources: {
      supabaseLatest,
      publicFile,
    },
  };
}
