import { NextResponse } from "next/server";

import { runRuntimeVerify } from "@/lib/runtime-check";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await runRuntimeVerify();
    return NextResponse.json({
      ok: result.ok,
      phase: result.phase,
      stage: result.stage,
      checkedAt: result.checkedAt,
      items: result.items,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        phase: "Phase B",
        stage: "B-4 Runtime Verification",
        error: error?.message ?? "unknown error",
      },
      { status: 500 },
    );
  }
}
