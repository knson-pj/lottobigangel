import { runRuntimeVerify } from "@/lib/runtime-check";

function color(ok: boolean): string {
  return ok ? "#065f46" : "#991b1b";
}

function background(ok: boolean): string {
  return ok ? "#ecfdf5" : "#fef2f2";
}

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const result = await runRuntimeVerify();

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif", display: "grid", gap: 16 }}>
      <section>
        <p style={{ margin: 0, fontWeight: 700, color: "#2563eb" }}>
          {result.phase} / {result.stage}
        </p>
        <h1 style={{ margin: "8px 0 12px" }}>Runtime Verify</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          checkedAt: {new Date(result.checkedAt).toLocaleString("ko-KR")}
        </p>
      </section>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: 16,
          background: result.ok ? "#f0fdf4" : "#fff7ed",
        }}
      >
        <strong>{result.ok ? "전체 점검 통과" : "일부 점검 실패"}</strong>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        {result.items.map((item) => (
          <article
            key={item.key}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 16,
              background: background(item.ok),
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{item.key}</h2>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  color: color(item.ok),
                  fontWeight: 700,
                }}
              >
                {item.ok ? "OK" : "FAIL"}
              </span>
            </div>
            <p style={{ marginTop: 10, marginBottom: 0, color: color(item.ok) }}>{item.message}</p>
            {item.detail ? (
              <pre
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: "#ffffff",
                  overflowX: "auto",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {JSON.stringify(item.detail, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
