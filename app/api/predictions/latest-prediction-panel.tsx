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
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/predictions/latest", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
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

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const topNumbers = useMemo(() => {
    return data?.prediction?.topNumbersSorted ?? [];
  }, [data]);

  const rankedNumbers = useMemo(() => {
    return (data?.prediction?.numbers ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank || b.probability - a.probability || a.number - b.number);
  }, [data]);

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">최신 예측 데이터를 불러오는 중...</p>
        </div>
      </section>
    );
  }

  if (error || !data?.prediction || !data.summary) {
    return (
      <section className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-rose-700">예측 데이터 로드 실패</h2>
          <p className="mt-2 text-sm text-rose-600">{error || "prediction_snapshot.json을 확인해 주세요."}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-600">Latest Prediction</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {data.summary.targetRound}회차 예측 스냅샷
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              생성 시각: {formatDate(data.summary.generatedAt)} · 소스: {data.summary.sourceTable}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 md:min-w-[280px]">
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">모델 버전</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{data.summary.modelVersion}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">피처 버전</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{data.summary.featureVersion}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">후보 개수</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{data.summary.candidateCount}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">상위 노출 수</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{data.prediction.topK}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.6fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">추천 숫자</h2>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              정렬된 상위 {topNumbers.length}개
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {topNumbers.map((num) => (
              <span
                key={num}
                className="inline-flex h-11 min-w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-900 shadow-sm"
              >
                {num}
              </span>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <p className="text-xs text-slate-500">랭크 기준 원본 순서</p>
            <p className="mt-2 break-words text-sm font-medium text-slate-800">
              {data.summary.topNumbersByRank.join(", ")}
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">번호별 확률</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              rank / probability
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <div className="grid grid-cols-[72px_72px_1fr_120px] bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div>Rank</div>
              <div>번호</div>
              <div>확률 바</div>
              <div className="text-right">확률</div>
            </div>

            <div className="divide-y divide-slate-100">
              {rankedNumbers.map((item) => (
                <div
                  key={`${item.rank}-${item.number}`}
                  className="grid grid-cols-[72px_72px_1fr_120px] items-center gap-3 px-4 py-3"
                >
                  <div className="text-sm font-semibold text-slate-700">{item.rank}</div>
                  <div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">
                      {item.number}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.max(1, Math.min(100, item.probability * 100))}%` }}
                    />
                  </div>
                  <div className="text-right text-sm font-medium text-slate-800">
                    {formatProbability(item.probability)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
