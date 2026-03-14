import { promises as fs } from "fs";
import path from "path";

export type PredictionNumber = {
  number: number;
  probability: number;
  rank: number;
  recentWindow?: number;
  calibrated?: boolean;
  extra?: Record<string, unknown>;
};

export type PredictionSnapshot = {
  snapshotVersion: number;
  generatedAt: string;
  source: {
    kind: string;
    table: string;
    exportId?: string | null;
  };
  prediction: {
    targetRound: number;
    modelKey: string;
    modelVersion: string;
    featureVersion?: string;
    topK: number;
    topNumbersByRank: number[];
    topNumbersSorted: number[];
    numbers: PredictionNumber[];
  };
  summary: {
    candidateCount: number;
    probabilitySum: number | null;
    maxProbability: number | null;
    minProbability: number | null;
  };
  metadata?: Record<string, unknown>;
};

const SNAPSHOT_RELATIVE_PATH = path.join("public", "prediction_snapshot.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function normalizePredictionNumber(value: unknown): PredictionNumber | null {
  if (!isRecord(value)) return null;

  const number = toNumber(value.number, NaN);
  const probability = toNumber(value.probability, NaN);
  const rank = toNumber(value.rank, NaN);

  if (!Number.isFinite(number) || !Number.isFinite(probability) || !Number.isFinite(rank)) {
    return null;
  }

  const normalized: PredictionNumber = {
    number,
    probability,
    rank,
  };

  const recentWindow = toOptionalNumber(value.recentWindow);
  if (recentWindow !== undefined) normalized.recentWindow = recentWindow;

  const calibrated = toOptionalBoolean(value.calibrated);
  if (calibrated !== undefined) normalized.calibrated = calibrated;

  if (isRecord(value.extra)) normalized.extra = value.extra;

  return normalized;
}

function normalizeSnapshot(raw: unknown): PredictionSnapshot | null {
  if (!isRecord(raw) || !isRecord(raw.source) || !isRecord(raw.prediction) || !isRecord(raw.summary)) {
    return null;
  }

  const numbersRaw = Array.isArray(raw.prediction.numbers) ? raw.prediction.numbers : [];
  const numbers = numbersRaw.map(normalizePredictionNumber).filter((item): item is PredictionNumber => item !== null);

  if (numbers.length === 0) return null;

  const snapshot: PredictionSnapshot = {
    snapshotVersion: toNumber(raw.snapshotVersion, 1),
    generatedAt: toStringValue(raw.generatedAt),
    source: {
      kind: toStringValue(raw.source.kind, "supabase"),
      table: toStringValue(raw.source.table, "model_probability_exports"),
      exportId: raw.source.exportId == null ? null : toStringValue(raw.source.exportId),
    },
    prediction: {
      targetRound: toNumber(raw.prediction.targetRound, 0),
      modelKey: toStringValue(raw.prediction.modelKey, "stage3-minimal"),
      modelVersion: toStringValue(raw.prediction.modelVersion, "unknown"),
      featureVersion: toStringValue(raw.prediction.featureVersion, "unknown"),
      topK: toNumber(raw.prediction.topK, numbers.length),
      topNumbersByRank: toNumberArray(raw.prediction.topNumbersByRank),
      topNumbersSorted: toNumberArray(raw.prediction.topNumbersSorted),
      numbers,
    },
    summary: {
      candidateCount: toNumber(raw.summary.candidateCount, numbers.length),
      probabilitySum: raw.summary.probabilitySum == null ? null : toNumber(raw.summary.probabilitySum, 0),
      maxProbability: raw.summary.maxProbability == null ? null : toNumber(raw.summary.maxProbability, 0),
      minProbability: raw.summary.minProbability == null ? null : toNumber(raw.summary.minProbability, 0),
    },
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };

  if (snapshot.prediction.topNumbersByRank.length === 0) {
    snapshot.prediction.topNumbersByRank = numbers
      .slice()
      .sort((a, b) => a.rank - b.rank || b.probability - a.probability || a.number - b.number)
      .map((item) => item.number);
  }

  if (snapshot.prediction.topNumbersSorted.length === 0) {
    snapshot.prediction.topNumbersSorted = snapshot.prediction.topNumbersByRank.slice().sort((a, b) => a - b);
  }

  return snapshot;
}

async function readSnapshotFromFile(): Promise<PredictionSnapshot | null> {
  try {
    const fullPath = path.join(process.cwd(), SNAPSHOT_RELATIVE_PATH);
    const text = await fs.readFile(fullPath, "utf-8");
    return normalizeSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function getPredictionSnapshot(): Promise<PredictionSnapshot | null> {
  return readSnapshotFromFile();
}

export async function getPredictionForRound(targetRound?: number): Promise<PredictionSnapshot | null> {
  const snapshot = await getPredictionSnapshot();
  if (!snapshot) return null;
  if (targetRound == null) return snapshot;
  return snapshot.prediction.targetRound === targetRound ? snapshot : null;
}

export function getTopPredictionNumbers(snapshot: PredictionSnapshot, limit = 30): number[] {
  return snapshot.prediction.topNumbersByRank.slice(0, Math.max(1, limit));
}

export function getSortedTopPredictionNumbers(snapshot: PredictionSnapshot, limit = 30): number[] {
  return getTopPredictionNumbers(snapshot, limit).slice().sort((a, b) => a - b);
}

export function getPredictionNumberMap(snapshot: PredictionSnapshot): Map<number, PredictionNumber> {
  return new Map(snapshot.prediction.numbers.map((item) => [item.number, item]));
}

export function getPredictionSummary(snapshot: PredictionSnapshot) {
  return {
    targetRound: snapshot.prediction.targetRound,
    modelKey: snapshot.prediction.modelKey,
    modelVersion: snapshot.prediction.modelVersion,
    featureVersion: snapshot.prediction.featureVersion ?? "unknown",
    candidateCount: snapshot.summary.candidateCount,
    topNumbersByRank: snapshot.prediction.topNumbersByRank,
    topNumbersSorted: snapshot.prediction.topNumbersSorted,
    generatedAt: snapshot.generatedAt,
    sourceTable: snapshot.source.table,
  };
}

export function getPredictionNumbers(snapshot: PredictionSnapshot): PredictionNumber[] {
  return snapshot.prediction.numbers.slice();
}

export function toPredictionDebugJson(snapshot: PredictionSnapshot): string {
  return JSON.stringify(
    {
      summary: getPredictionSummary(snapshot),
      numbers: snapshot.prediction.numbers,
    },
    null,
    2,
  );
}
