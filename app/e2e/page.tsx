import { runE2ECheck } from "@/lib/e2e-check";

export const dynamic = "force-dynamic";

function okBadge(ok: boolean) {
  return {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    color: ok ? "#065f46" : "#991b1b",
    background: ok ? "#d1fae5" : "#fee2e2",
  } as const;
}

function cardStyle() {
  return {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    padding: 16,
    background: "#fff",
  } as const;
}

export default async function E2EPage() {
  const result = await runE2ECheck();

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif", display: "grid", gap: 16 }}>
      <section style={cardStyle()}>
        <p style={{ margin: 0, color: "#2563eb", fontWeight: 700 }}>Phase B / B-5</p>
        <h1 style={{ margin: "8px 0 12px" }}>End-to-End Execution Check</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          checkedAt: {result.checkedAt}
        </p>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>기본 상태</h2>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>latestDrawRound: {String(result.latestDrawRound)}</li>
          <li>nextTargetRound: {String(result.nextTargetRound)}</li>
          <li>lotto_draws count: {String(result.tables.lottoDrawsCount)}</li>
          <li>prediction_runs count: {String(result.tables.predictionRunsCount)}</li>
          <li>model_probability_exports count: {String(result.tables.modelProbabilityExportsCount)}</li>
        </ul>
      </section>

      <section style={cardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Dry Run Prediction</h2>
          <span style={okBadge(result.dryRun.ok)}>{result.dryRun.ok ? "OK" : "FAIL"}</span>
        </div>
        <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>targetRound: {String(result.dryRun.targetRound)}</li>
          <li>modelVersion: {result.dryRun.modelVersion ?? "-"}</li>
          <li>featureVersion: {result.dryRun.featureVersion ?? "-"}</li>
          <li>topPoolSize: {String(result.dryRun.topPoolSize ?? "-")}</li>
          <li>comboCount: {String(result.dryRun.comboCount ?? "-")}</li>
          <li>top24Sorted: {result.dryRun.top24Sorted?.join(", ") ?? "-"}</li>
          <li>error: {result.dryRun.error ?? "-"}</li>
        </ul>
      </section>

      <section style={cardStyle()}>
        <h2 style={{ marginTop: 0 }}>Snapshot Sources</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <strong>Supabase latest snapshot</strong>
              <span style={okBadge(result.snapshotSources.supabaseLatest.ok)}>
                {result.snapshotSources.supabaseLatest.ok ? "OK" : "FAIL"}
              </span>
            </div>
            <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>targetRound: {String(result.snapshotSources.supabaseLatest.targetRound ?? "-")}</li>
              <li>modelVersion: {result.snapshotSources.supabaseLatest.modelVersion ?? "-"}</li>
              <li>featureVersion: {result.snapshotSources.supabaseLatest.featureVersion ?? "-"}</li>
              <li>candidateCount: {String(result.snapshotSources.supabaseLatest.candidateCount ?? "-")}</li>
              <li>generatedAt: {result.snapshotSources.supabaseLatest.generatedAt ?? "-"}</li>
              <li>error: {result.snapshotSources.supabaseLatest.error ?? "-"}</li>
            </ul>
          </div>

          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <strong>public/prediction_snapshot.json</strong>
              <span style={okBadge(result.snapshotSources.publicFile.ok)}>
                {result.snapshotSources.publicFile.ok ? "OK" : "FAIL"}
              </span>
            </div>
            <ul style={{ marginTop: 12, marginBottom: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>targetRound: {String(result.snapshotSources.publicFile.targetRound ?? "-")}</li>
              <li>modelVersion: {result.snapshotSources.publicFile.modelVersion ?? "-"}</li>
              <li>featureVersion: {result.snapshotSources.publicFile.featureVersion ?? "-"}</li>
              <li>candidateCount: {String(result.snapshotSources.publicFile.candidateCount ?? "-")}</li>
              <li>generatedAt: {result.snapshotSources.publicFile.generatedAt ?? "-"}</li>
              <li>error: {result.snapshotSources.publicFile.error ?? "-"}</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
