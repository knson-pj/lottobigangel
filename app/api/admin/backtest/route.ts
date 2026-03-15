import { NextResponse } from "next/server";
import { z } from "zod";

import { runBacktest } from "@/lib/backtest-engine";
import { writeServerLog } from "@/lib/log";

const bodySchema = z
  .object({
    rounds: z.number().int().min(1).max(60).optional(),
    historyWindow: z.number().int().min(20).max(200).optional(),
    topPoolSize: z.number().int().min(24).max(30).optional(),
    comboCount: z.number().int().min(1).max(12).optional(),
  })
  .optional();

async function executeBacktest(input?: z.infer<typeof bodySchema>) {
  return runBacktest({
    rounds: input?.rounds,
    historyWindow: input?.historyWindow,
    topPoolSize: input?.topPoolSize,
    comboCount: input?.comboCount,
  });
}

export async function GET() {
  const route = "/api/admin/backtest";

  try {
    const result = await executeBacktest();

    await writeServerLog({
      level: "info",
      eventType: "backtest.success",
      route,
      payload: {
        evaluatedRounds: result.summary.evaluatedRounds,
        averageTopHits: result.summary.averageTopHits,
        averageMaxComboHit: result.summary.averageMaxComboHit,
      },
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    await writeServerLog({
      level: "error",
      eventType: "backtest.error",
      route,
      payload: {
        message: error?.message ?? "unknown error",
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "unknown error",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const route = "/api/admin/backtest";

  try {
    const parsed = bodySchema.parse(await req.json());
    const result = await executeBacktest(parsed);

    await writeServerLog({
      level: "info",
      eventType: "backtest.success",
      route,
      payload: {
        evaluatedRounds: result.summary.evaluatedRounds,
        averageTopHits: result.summary.averageTopHits,
        averageMaxComboHit: result.summary.averageMaxComboHit,
      },
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    await writeServerLog({
      level: "error",
      eventType: "backtest.error",
      route,
      payload: {
        message: error?.message ?? "unknown error",
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "unknown error",
      },
      { status: 500 },
    );
  }
}
