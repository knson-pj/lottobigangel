const RESULT_ALL_URL = 'https://lottotapa.com/stat/result_all.php'
const RESULT_DETAIL_URL = (round: number) => `https://lottotapa.com/stat/result/${round}`

export type DrawRow = {
  round: number
  draw_date: string
  machine_no: number | null
  n1: number
  n2: number
  n3: number
  n4: number
  n5: number
  n6: number
  bonus: number
  odd_count: number | null
  even_count: number | null
  low_count: number | null
  high_count: number | null
  ac_value: number | null
  end_sum: number | null
  total_sum: number | null
  source_url: string
}

export type DrawFeatureRow = {
  round: number
  carryover_count: number
  neighbor_count: number
  consecutive_pair_count: number
  same_ending_pair_count: number
  same_ending_max_group: number
  twin_count: number
  twin_flag: boolean
  multiple_2_count: number
  multiple_3_count: number
  multiple_5_count: number
  sum_123: number
  sum_456: number
  sum_123_456_gap: number
  payload: {
    sameEndingHist: number[]
    division: Record<string, number[]>
    divisionExcludeCount: Record<string, number>
    ninePalace: number[]
  }
}

export type SyncLatestResult = {
  latestRound: number
  draw: DrawRow
  features: DrawFeatureRow
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    cache: 'no-store'
  })

  if (!res.ok) {
    throw new Error(`fetch failed: ${url} (${res.status})`)
  }

  return await res.text()
}

function parseLatestRound(resultAllHtml: string) {
  const text = htmlToText(resultAllHtml)
  const matches = [...text.matchAll(/(\d+)회 로또 당첨번호\s*\((\d{4}-\d{2}-\d{2})\)\s*(\d+)호기/g)]
  if (matches.length === 0) {
    throw new Error('latest round not found from result_all page')
  }
  return Math.max(...matches.map((m) => Number(m[1])))
}

function parseHeader(text: string, round: number) {
  const header = text.match(new RegExp(`${round}회 로또 당첨번호\\s*\\((\\d{4}-\\d{2}-\\d{2})\\)\\s*(\\d+)호기`))
  if (!header) {
    throw new Error(`header not found for round ${round}`)
  }

  return {
    drawDate: header[1],
    machineNo: Number(header[2])
  }
}

function parseStats(text: string) {
  const stats = text.match(/홀짝\s*(\d+)\s*:\s*(\d+)\s*저고\s*:?\s*(\d+)\s*:\s*(\d+)\s*AC값\s*(\d+)\s*끝수합\s*(\d+)\s*총합\s*(\d+)/)
  if (!stats) {
    return {
      oddCount: null,
      evenCount: null,
      lowCount: null,
      highCount: null,
      acValue: null,
      endSum: null,
      totalSum: null
    }
  }

  return {
    oddCount: Number(stats[1]),
    evenCount: Number(stats[2]),
    lowCount: Number(stats[3]),
    highCount: Number(stats[4]),
    acValue: Number(stats[5]),
    endSum: Number(stats[6]),
    totalSum: Number(stats[7])
  }
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values)).sort((a, b) => a - b)
}

function parseNumbersFromBody(html: string, round: number) {
  const slicePoint = html.indexOf(`${round}회 로또 당첨번호`)
  const source = slicePoint >= 0 ? html.slice(slicePoint, slicePoint + 8000) : html.slice(0, 8000)

  // 1) Prefer ball-like spans/divs that contain only 1~45
  const exactBlocks = [...source.matchAll(/>(\d{1,2})</g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 1 && n <= 45)

  // Scan contiguous windows for 7 distinct lotto-ish values
  for (let i = 0; i <= exactBlocks.length - 7; i++) {
    const candidate = exactBlocks.slice(i, i + 7)
    if (candidate.every((n) => n >= 1 && n <= 45)) {
      const first6 = candidate.slice(0, 6)
      const bonus = candidate[6]
      if (uniqueSorted(first6).length === 6 && !first6.includes(bonus)) {
        return {
          main: uniqueSorted(first6),
          bonus
        }
      }
    }
  }

  const text = htmlToText(source)
  const headerPos = text.indexOf(`${round}회 로또 당첨번호`)
  const sub = headerPos >= 0 ? text.slice(headerPos, headerPos + 500) : text.slice(0, 500)
  const numbers = [...sub.matchAll(/\b\d+\b/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n >= 1 && n <= 45)

  for (let i = 0; i <= numbers.length - 7; i++) {
    const candidate = numbers.slice(i, i + 7)
    const first6 = candidate.slice(0, 6)
    const bonus = candidate[6]
    if (uniqueSorted(first6).length === 6 && !first6.includes(bonus)) {
      return {
        main: uniqueSorted(first6),
        bonus
      }
    }
  }

  throw new Error(`could not parse winning numbers for round ${round}`)
}

function sameEndingStats(numbers: number[]) {
  const hist = Array.from({ length: 10 }, () => 0)
  for (const n of numbers) hist[n % 10] += 1
  return {
    hist,
    pairCount: hist.filter((x) => x >= 2).length,
    maxGroup: Math.max(...hist)
  }
}

function consecutivePairCount(numbers: number[]) {
  return numbers.reduce((count, current, index) => {
    if (index === 0) return count
    return count + (current - numbers[index - 1] === 1 ? 1 : 0)
  }, 0)
}

function ninePalaceIndex(n: number) {
  let value = n
  while (value > 9) {
    value = String(value)
      .split('')
      .map(Number)
      .reduce((a, b) => a + b, 0)
  }
  return value === 0 ? 9 : value
}

function ninePalaceCounts(numbers: number[]) {
  const counts = Array.from({ length: 9 }, () => 0)
  for (const n of numbers) {
    counts[ninePalaceIndex(n) - 1] += 1
  }
  return counts
}

function divisionGroups(parts: 3 | 5 | 7 | 9 | 15) {
  if (parts === 3) {
    return [
      Array.from({ length: 15 }, (_, i) => i + 1),
      Array.from({ length: 15 }, (_, i) => i + 16),
      Array.from({ length: 15 }, (_, i) => i + 31)
    ]
  }

  if (parts === 5) {
    return [
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14, 15, 16, 17, 18],
      [19, 20, 21, 22, 23, 24, 25, 26, 27],
      [28, 29, 30, 31, 32, 33, 34, 35, 36],
      [37, 38, 39, 40, 41, 42, 43, 44, 45]
    ]
  }

  if (parts === 7) {
    return [
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
      [13, 14, 15, 16, 17, 18],
      [19, 20, 21, 22, 23, 24],
      [25, 26, 27, 28, 29, 30],
      [31, 32, 33, 34, 35, 36],
      [37, 38, 39, 40, 41, 42, 43, 44, 45]
    ]
  }

  if (parts === 9) {
    return [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
      [16, 17, 18, 19, 20],
      [21, 22, 23, 24, 25],
      [26, 27, 28, 29, 30],
      [31, 32, 33, 34, 35],
      [36, 37, 38, 39, 40],
      [41, 42, 43, 44, 45]
    ]
  }

  return [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [10, 11, 12],
    [13, 14, 15],
    [16, 17, 18],
    [19, 20, 21],
    [22, 23, 24],
    [25, 26, 27],
    [28, 29, 30],
    [31, 32, 33],
    [34, 35, 36],
    [37, 38, 39],
    [40, 41, 42],
    [43, 44, 45]
  ]
}

function countsByGroups(numbers: number[], groups: number[][]) {
  return groups.map((group) => numbers.filter((n) => group.includes(n)).length)
}

function buildFeatures(draw: DrawRow, previousNumbers: number[]) {
  const numbers = [draw.n1, draw.n2, draw.n3, draw.n4, draw.n5, draw.n6].sort((a, b) => a - b)
  const previousSet = new Set(previousNumbers)
  const neighborPool = new Set<number>()

  for (const n of previousNumbers) {
    if (n > 1) neighborPool.add(n - 1)
    if (n < 45) neighborPool.add(n + 1)
  }

  const sameEnding = sameEndingStats(numbers)
  const division = {
    div3: countsByGroups(numbers, divisionGroups(3)),
    div5: countsByGroups(numbers, divisionGroups(5)),
    div7: countsByGroups(numbers, divisionGroups(7)),
    div9: countsByGroups(numbers, divisionGroups(9)),
    div15: countsByGroups(numbers, divisionGroups(15))
  }

  const divisionExcludeCount = Object.fromEntries(
    Object.entries(division).map(([key, values]) => [key, values.filter((x) => x === 0).length])
  )

  return {
    round: draw.round,
    carryover_count: numbers.filter((n) => previousSet.has(n)).length,
    neighbor_count: numbers.filter((n) => neighborPool.has(n)).length,
    consecutive_pair_count: consecutivePairCount(numbers),
    same_ending_pair_count: sameEnding.pairCount,
    same_ending_max_group: sameEnding.maxGroup,
    twin_count: numbers.filter((n) => [11, 22, 33, 44].includes(n)).length,
    twin_flag: numbers.some((n) => [11, 22, 33, 44].includes(n)),
    multiple_2_count: numbers.filter((n) => n % 2 === 0).length,
    multiple_3_count: numbers.filter((n) => n % 3 === 0).length,
    multiple_5_count: numbers.filter((n) => n % 5 === 0).length,
    sum_123: numbers.slice(0, 3).reduce((a, b) => a + b, 0),
    sum_456: numbers.slice(3).reduce((a, b) => a + b, 0),
    sum_123_456_gap: Math.abs(
      numbers.slice(3).reduce((a, b) => a + b, 0) - numbers.slice(0, 3).reduce((a, b) => a + b, 0)
    ),
    payload: {
      sameEndingHist: sameEnding.hist,
      division,
      divisionExcludeCount,
      ninePalace: ninePalaceCounts(numbers)
    }
  } satisfies DrawFeatureRow
}

export async function fetchLatestConfirmedDraw(): Promise<DrawRow> {
  const resultAllHtml = await fetchText(RESULT_ALL_URL)
  const latestRound = parseLatestRound(resultAllHtml)
  const detailUrl = RESULT_DETAIL_URL(latestRound)
  const detailHtml = await fetchText(detailUrl)
  const text = htmlToText(detailHtml)

  const header = parseHeader(text, latestRound)
  const stats = parseStats(text)
  const parsedNumbers = parseNumbersFromBody(detailHtml, latestRound)

  return {
    round: latestRound,
    draw_date: header.drawDate,
    machine_no: Number.isFinite(header.machineNo) ? header.machineNo : null,
    n1: parsedNumbers.main[0],
    n2: parsedNumbers.main[1],
    n3: parsedNumbers.main[2],
    n4: parsedNumbers.main[3],
    n5: parsedNumbers.main[4],
    n6: parsedNumbers.main[5],
    bonus: parsedNumbers.bonus,
    odd_count: stats.oddCount,
    even_count: stats.evenCount,
    low_count: stats.lowCount,
    high_count: stats.highCount,
    ac_value: stats.acValue,
    end_sum: stats.endSum,
    total_sum: stats.totalSum,
    source_url: detailUrl
  }
}

export function buildDrawFeatures(draw: DrawRow, previousNumbers: number[]) {
  return buildFeatures(draw, previousNumbers)
}

export async function syncLatestWithDerivedFeatures(getPreviousNumbers: (round: number) => Promise<number[]>) {
  const draw = await fetchLatestConfirmedDraw()
  const previousNumbers = await getPreviousNumbers(draw.round)
  const features = buildDrawFeatures(draw, previousNumbers)
  return {
    latestRound: draw.round,
    draw,
    features
  } satisfies SyncLatestResult
}
