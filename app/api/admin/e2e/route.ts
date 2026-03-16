import { NextResponse } from "next/server";
import { runE2ECheck } from "@/lib/e2e-check";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await runE2ECheck();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "unknown error",
      },
      { status: 500 },
    );
  }
}
