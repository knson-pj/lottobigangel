import { NextResponse } from "next/server";
import { getPredictionSnapshot, getPredictionSummary } from "@/lib/predict";

export const dynamic = "force-static";

export async function GET() {
  const snapshot = await getPredictionSnapshot();

  if (!snapshot) {
    return NextResponse.json(
      {
        ok: false,
        error: "prediction_snapshot.json not found or invalid",
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
