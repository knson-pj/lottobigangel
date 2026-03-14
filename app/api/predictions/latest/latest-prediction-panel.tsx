"use client";

import { useEffect, useMemo, useState } from "react";

type PredictionNumber = {
  number: number;
  probability: number;
  rank: number;
  recentWindow?: number;
  calibrated?: boolean;
  extra?: Record<string, unknown>;
};

type PredictionApiResponse = {
  ok: boolean;
  error?: string;
  summary?: {
    targetRound: number;
    modelKey: string;
    modelVersion: string;
    featureVersion: string;
    candidateCount: number;
    topNumbersByRank: number[];
    topNumbersSorted: number[];
    generatedAt: string;
    sourceTable: string;
  };
  prediction?: {
    targetRound: number;
    modelKey: string;
    modelVersion: string;
    featureVersion?: string;
    topK: number;
    topNumbersByRank: number[];
    topNumbersSorted: number[];
    numbers: PredictionNumber[];
  };
  metadata?: Record<string, unknown>;
  generatedAt?: string;
  source?: {
    kind: string;
    table: string;
    exportId?: string | null;
  };
};

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function LatestPredictionPanel() {
  const [data, setData] = useState<PredictionApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/predictions/latest", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        const json = (await response.json()) as PredictionApiResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || "예측 데이터를 불러오지 못했습니다.");
        }

        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "예측 데이터를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const topNumbers = useMemo(() => data?.prediction?.topNumbersSorted ?? [], [data]);

  const rankedNumbers = useMemo(() => {
    return (data?.prediction?.numbers ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank || b.probability - a.probability || a.number - b.number);
  }, [data]);

  if (loading) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
        <h1>Latest Predictions</h1>
        <p>최신 예측 데이터를 불러오는 중...</p>
      </main>
    );
  }

  if (error || !data?.prediction || !data.summary) {
    return (
      <main style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
        <h1>Latest Predictions</h1>
        <p style={{ color: "#b91c1c" }}>{error || "prediction_snapshot.json을 확인해 주세요."}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif", display: "grid", gap: 24 }}>
      <section>
        <p style={{ margin: 0, color: "#059669", fontWeight: 700 }}>Latest Prediction</p>
        <h1 style={{ margin: "8px 0 12px" }}>{data.summary.targetRound}회차 예측 스냅샷</h1>
        <p style={{ margin: 0, color: "#475569" }}>
          생성 시각: {formatDate(data.summary.generatedAt)} / 소스: {data.summary.sourceTable}
        </p>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>모델 버전</div>
          <div style={{ marginTop: 6, fontWeight: 700 }}>{data.summary.modelVersion}</div>
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>피처 버전</div>
          <div style={{ marginTop: 6, fontWeight: 700 }}>{data.summary.featureVersion}</div>
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>후보 개수</div>
          <div style={{ marginTop: 6, fontWeight: 700 }}>{data.summary.candidateCount}</div>
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>상위 노출 수</div>
          <div style={{ marginTop: 6, fontWeight: 700 }}>{data.prediction.topK}</div>
        </div>
      </section>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>추천 숫자</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {topNumbers.map((num) => (
            <span
              key={num}
              style={{
                minWidth: 42,
                height: 42,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                fontWeight: 700,
              }}
            >
              {num}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 16, color: "#475569" }}>
          랭크 기준 원본 순서: {data.summary.topNumbersByRank.join(", ")}
        </p>
      </section>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>번호별 확률</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {rankedNumbers.map((item) => (
            <div
              key={`${item.rank}-${item.number}`}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 72px 1fr 110px",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 700, color: "#334155" }}>{item.rank}</div>
              <div>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    background: "#ecfdf5",
                    color: "#047857",
                    fontWeight: 700,
                  }}
                >
                  {item.number}
                </span>
              </div>
              <div style={{ height: 10, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(1, Math.min(100, item.probability * 100))}%`,
                    height: "100%",
                    background: "#10b981",
                  }}
                />
              </div>
              <div style={{ textAlign: "right", fontWeight: 600 }}>{formatProbability(item.probability)}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
