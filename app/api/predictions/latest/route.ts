import { NextResponse } from "next/server";

import { getLatestModelProbabilitySnapshot } from "@/lib/model-probability-exports";
import { getPredictionSnapshot, getPredictionSummary } from "@/lib/predict";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = (await getLatestModelProbabilitySnapshot()) ?? (await getPredictionSnapshot());

  if (!snapshot) {
    return NextResponse.json(
      {
        ok: false,
        error: "No prediction data found in model_probability_exports or public/prediction_snapshot.json",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    summary: getPredictionSummary(snapshot),
    prediction: snapshot.prediction,
    metadata: snapshot.metadata ?? {},
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
  });
}
