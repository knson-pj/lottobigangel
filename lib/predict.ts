import { supabaseAdmin } from '@/lib/supabase-admin'

export type NumberScore = {
  number: number
  probability: number
}

export type ComboScore = {
  rank: number
  numbers: [number, number, number, number, number, number]
  score: number
  meta?: Record<string, unknown>
}

type ExportRow = {
  number: number
  probability: number
}

function seededRandom(seed: number) {
  let value = seed % 2147483647
  if (value <= 0) value += 2147483646
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function scoreCombo(combo: number[], probabilities: Map<number, number>) {
  let score = combo.reduce((sum, n) => sum + (probabilities.get(n) ?? 0), 0)

  const oddCount = combo.filter((n) => n % 2 === 1).length
  const lowCount = combo.filter((n) => n <= 22).length
  const totalSum = combo.reduce((a, b) => a + b, 0)
  const endings = combo.map((n) => n % 10)
  const endingUnique = new Set(endings).size

  if ([2, 3, 4].includes(oddCount)) score += 0.12
  if ([2, 3, 4].includes(lowCount)) score += 0.12
  if (90 <= totalSum && totalSum <= 180) score += 0.18
  if (endingUnique <= 3) score -= 0.18

  return Number(score.toFixed(6))
}

function buildCombosFromScores(numberScores: NumberScore[]) {
  const topPool = numberScores.slice(0, 24).map((x) => x.number).sort((a, b) => a - b)
  const probMap = new Map(numberScores.map((x) => [x.number, x.probability]))

  const combos: ComboScore[] = []
  let comboRank = 1

  for (let i = 0; i < topPool.length - 5 && combos.length < 20; i++) {
    for (let j = i + 1; j < topPool.length - 4 && combos.length < 20; j++) {
      const combo = [
        topPool[i],
        topPool[j],
        topPool[(j + 2) % topPool.length],
        topPool[(j + 5) % topPool.length],
        topPool[(j + 8) % topPool.length],
        topPool[(j + 11) % topPool.length]
      ]

      const unique = Array.from(new Set(combo)).sort((a, b) => a - b)
      if (unique.length !== 6) continue

      combos.push({
        rank: comboRank++,
}
