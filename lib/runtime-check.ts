import { promises as fs } from "fs";
import path from "path";

import { getLatestModelProbabilitySnapshot } from "@/lib/model-probability-exports";
import { getPredictionSnapshot } from "@/lib/predict";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type VerifyItem = {
  key: string;
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
};

export type RuntimeVerifyResult = {
  ok: boolean;
  phase: string;
  stage: string;
  checkedAt: string;
  items: VerifyItem[];
};

function nowIso(): string {
  return new Date().toISOString();
}

async function checkEnv(): Promise<VerifyItem> {
  const missing: string[] = [];

  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    key: "env",
    ok: missing.length === 0,
    message: missing.length === 0 ? "필수 환경변수 확인 완료" : `누락 환경변수: ${missing.join(", ")}`,
    detail: {
      missing,
    },
  };
}

async function checkLottoDraws(): Promise<VerifyItem> {
  const countRes = await supabaseAdmin
    .from("lotto_draws")
    .select("*", { count: "exact", head: true });

  if (countRes.error) {
    return {
      key: "lotto_draws",
      ok: false,
      message: countRes.error.message,
    };
  }

  const latestRes = await supabaseAdmin
    .from("lotto_draws")
    .select("round,draw_date")
    .order("round", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRes.error) {
    return {
      key: "lotto_draws",
      ok: false,
      message: latestRes.error.message,
      detail: {
        count: countRes.count ?? 0,
      },
    };
  }

  const latest = latestRes.data ?? null;

  return {
    key: "lotto_draws",
    ok: (countRes.count ?? 0) >= 20,
    message:
      (countRes.count ?? 0) >= 20
        ? "lotto_draws 학습/예측 최소 데이터 확보"
        : "lotto_draws 데이터가 부족함 (최소 20회차 권장)",
    detail: {
      count: countRes.count ?? 0,
      latestRound: latest?.round ?? null,
      latestDrawDate: latest?.draw_date ?? null,
    },
  };
}

async function checkPredictionRuns(): Promise<VerifyItem> {
  const countRes = await supabaseAdmin
    .from("prediction_runs")
    .select("*", { count: "exact", head: true });

  if (countRes.error) {
    return {
      key: "prediction_runs",
      ok: false,
      message: countRes.error.message,
    };
  }

  const latestRes = await supabaseAdmin
    .from("prediction_runs")
    .select("id,target_round,model_version,feature_version,triggered_by,status,created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRes.error) {
    return {
      key: "prediction_runs",
      ok: false,
      message: latestRes.error.message,
      detail: {
        count: countRes.count ?? 0,
      },
    };
  }

  return {
    key: "prediction_runs",
    ok: (countRes.count ?? 0) >= 1,
    message:
      (countRes.count ?? 0) >= 1
        ? "prediction_runs 적재 확인"
        : "prediction_runs 데이터 없음 (/api/predict 또는 /api/cron/daily-predict 실행 필요)",
    detail: {
      count: countRes.count ?? 0,
      latest: latestRes.data ?? null,
    },
  };
}

async function checkModelProbabilityExports(): Promise<VerifyItem> {
  const countRes = await supabaseAdmin
    .from("model_probability_exports")
    .select("*", { count: "exact", head: true });

  if (countRes.error) {
    return {
      key: "model_probability_exports",
      ok: false,
      message: countRes.error.message,
    };
  }

  const latestSnapshot = await getLatestModelProbabilitySnapshot().catch((error: Error) => {
    return {
      __error: error.message,
    } as unknown as null;
  });

  if (latestSnapshot && "__error" in (latestSnapshot as any)) {
    return {
      key: "model_probability_exports",
      ok: false,
      message: (latestSnapshot as any).__error,
      detail: {
        count: countRes.count ?? 0,
      },
    };
  }

  return {
    key: "model_probability_exports",
    ok: (countRes.count ?? 0) >= 1 && !!latestSnapshot,
    message:
      (countRes.count ?? 0) >= 1 && !!latestSnapshot
        ? "model_probability_exports 최신 스냅샷 확인"
        : "model_probability_exports 데이터 없음",
    detail: {
      count: countRes.count ?? 0,
      latestTargetRound: latestSnapshot?.prediction.targetRound ?? null,
      latestModelVersion: latestSnapshot?.prediction.modelVersion ?? null,
      latestFeatureVersion: latestSnapshot?.prediction.featureVersion ?? null,
    },
  };
}

async function checkPublicSnapshot(): Promise<VerifyItem> {
  const filePath = path.join(process.cwd(), "public", "prediction_snapshot.json");

  try {
    await fs.access(filePath);
  } catch {
    return {
      key: "public_snapshot",
      ok: false,
      message: "public/prediction_snapshot.json 파일이 없음",
      detail: {
        filePath,
      },
    };
  }

  const snapshot = await getPredictionSnapshot();

  return {
    key: "public_snapshot",
    ok: !!snapshot,
    message: snapshot
      ? "public/prediction_snapshot.json 읽기 성공"
      : "public/prediction_snapshot.json 파일은 있으나 형식이 잘못됨",
    detail: snapshot
      ? {
          targetRound: snapshot.prediction.targetRound,
          modelVersion: snapshot.prediction.modelVersion,
          featureVersion: snapshot.prediction.featureVersion ?? null,
          generatedAt: snapshot.generatedAt,
        }
      : {
          filePath,
        },
  };
}

export async function runRuntimeVerify(): Promise<RuntimeVerifyResult> {
  const items = await Promise.all([
    checkEnv(),
    checkLottoDraws(),
    checkPredictionRuns(),
    checkModelProbabilityExports(),
    checkPublicSnapshot(),
  ]);

  return {
    ok: items.every((item) => item.ok),
    phase: "Phase B",
    stage: "B-4 Runtime Verification",
    checkedAt: nowIso(),
    items,
  };
}
