import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  BarChart as RBarChart,
  Bar,
  LabelList,
} from 'recharts'
import './App.css'

type AnyRecord = Record<string, unknown>

const DATASET_ID = 'c3uy-2p5r'
const API_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function coerceNumber(value: unknown): number | undefined {
  if (isNumber(value)) return value
  if (isString(value)) {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function formatHeader(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function App() {
  const [rows, setRows] = useState<AnyRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [groupKey, setGroupKey] = useState<string | undefined>(undefined)
  const [metricKey, setMetricKey] = useState<string | undefined>(undefined)
  const [dateKey, setDateKey] = useState<string | undefined>(undefined)
  const [selectedGroupValue, setSelectedGroupValue] = useState<string>('All')
  const PAGE_SIZE = 1000
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadInitial() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`${API_URL}?$limit=${PAGE_SIZE}&$offset=0`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as AnyRecord[]
        if (cancelled) return
        setRows(data)
        setOffset(data.length)
        setHasMore(data.length === PAGE_SIZE)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadInitial()
    return () => {
      cancelled = true
    }
  }, [])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`${API_URL}?$limit=${PAGE_SIZE}&$offset=${offset}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as AnyRecord[]
      setRows((prev) => prev.concat(data))
      setOffset((prev) => prev + data.length)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoadingMore(false)
    }
  }

  const allColumns = useMemo(() => {
    if (rows.length === 0) return []
    const keys = new Set<string>()
    for (const r of rows) {
      Object.keys(r).forEach((k) => keys.add(k))
    }
    return Array.from(keys)
  }, [rows])

  const stringColumns = useMemo(() => {
    const preferred = allColumns.filter((c) =>
      rows.some((r) => isString(r[c]) && (r[c] as string).trim()),
    )
    return preferred
  }, [allColumns, rows])

  const numericColumns = useMemo(() => {
    return allColumns.filter((c) => rows.some((r) => coerceNumber(r[c]) !== undefined))
  }, [allColumns, rows])

  const dateColumns = useMemo(() => {
    const threshold = 6
    const columns: string[] = []
    for (const c of allColumns) {
      let hits = 0
      for (const r of rows) {
        const v = r[c]
        if (isString(v) && !Number.isFinite(Number(v))) {
          const t = Date.parse(v)
          if (!Number.isNaN(t)) {
            hits++
            if (hits >= threshold) {
              columns.push(c)
              break
            }
          }
        }
      }
    }
    return columns
  }, [allColumns, rows])

  // Best-effort geography name column for human-friendly labels
  const nameKey = useMemo(() => {
    const candidates = [
      'geo_id_name',
      'geoid_name',
      'geo_name',
      'neighborhood_name',
      'neighborhood',
      'borough',
      'community_district',
      'area_name',
      'zone_name',
    ]
    const lower = new Set(stringColumns.map((c) => c.toLowerCase()))
    return candidates.find((c) => lower.has(c)) || undefined
  }, [stringColumns])
  // Initialize defaults once data lands
  useEffect(() => {
    if (rows.length === 0) return
    setGroupKey((prev) => {
      if (prev) return prev
      const preferredCandidates = ['geo_id_name', 'geoid_name', 'geo_name', 'borough', 'neighborhood', 'community_district']
      const preferred = stringColumns.find((c) => preferredCandidates.includes(c.toLowerCase()))
      return preferred || stringColumns[0]
    })
    setMetricKey((prev) => {
      if (prev) return prev
      // Prefer obvious metric-like names
      const candidates = ['air_quality_index', 'aqi', 'pm25', 'pm_2_5', 'no2', 'ozone', 'so2', 'value', 'score']
      const found = numericColumns.find((c) => candidates.includes(c.toLowerCase()))
      return found || numericColumns[0]
    })
    setDateKey((prev) => {
      if (prev) return prev
      const candidates = ['date', 'measurement_date', 'sample_date', 'created_date', 'time', 'timestamp', 'datetime']
      const found =
        dateColumns.find((c) => candidates.includes(c.toLowerCase())) || dateColumns[0]
      return found
    })
  }, [rows, stringColumns, numericColumns, dateColumns])

  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows
    const needle = query.toLowerCase()
    return rows.filter((r) =>
      Object.values(r).some((v) => isString(v) && v.toLowerCase().includes(needle)),
    )
  }, [rows, query])

  const chartData = useMemo(() => {
    if (!groupKey || !metricKey) return [] as { label: string; value: number }[]
    type Latest = { dateMs: number; value: number }
    const latestByGroup = new Map<string, Latest>()
    const idToName = new Map<string, string>()
    for (const r of filteredRows) {
      const g = r[groupKey]
      if (!isString(g) || !g.trim()) continue
      const n = coerceNumber(r[metricKey])
      if (n === undefined) continue
      if (nameKey) {
        const nm = r[nameKey]
        if (isString(nm) && nm.trim() && !idToName.has(g)) idToName.set(g, nm)
      }
      let t = 0
      if (dateKey) {
        const ds = r[dateKey]
        if (isString(ds)) {
          const tt = Date.parse(ds)
          if (!Number.isNaN(tt)) t = tt
        }
      }
      const prev = latestByGroup.get(g)
      if (!prev || t >= prev.dateMs) {
        latestByGroup.set(g, { dateMs: t, value: n })
      }
    }
    const data = Array.from(latestByGroup.entries()).map(([id, v]) => ({ label: idToName.get(id) ?? String(id), value: v.value }))
    return data.sort((a, b) => b.value - a.value).slice(0, 10)
  }, [filteredRows, groupKey, metricKey, dateKey, nameKey])

  const groupOptions = useMemo(() => {
    if (!groupKey) return [] as { id: string; name: string }[]
    const counts = new Map<string, number>()
    const idToName = new Map<string, string>()
    for (const r of filteredRows) {
      const g = r[groupKey]
      if (isString(g) && g.trim()) {
        counts.set(g, (counts.get(g) ?? 0) + 1)
        if (nameKey) {
          const nm = r[nameKey]
          if (isString(nm) && nm.trim() && !idToName.has(g)) idToName.set(g, nm)
        }
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => ({ id, name: idToName.get(id) ?? String(id) }))
      .slice(0, 50)
  }, [filteredRows, groupKey, nameKey])

  const timeSeries = useMemo(() => {
    if (!metricKey || !dateKey) return [] as { date: string; value: number }[]
    const latestPerDay = new Map<string, number>()
    for (const r of filteredRows) {
      if (groupKey && selectedGroupValue !== 'All') {
        const g = r[groupKey]
        if (!isString(g) || g !== selectedGroupValue) continue
      }
      const ds = r[dateKey]
      if (!isString(ds)) continue
      const t = Date.parse(ds)
      if (Number.isNaN(t)) continue
      const d = new Date(t).toISOString().slice(0, 10) // YYYY-MM-DD
      const n = coerceNumber(r[metricKey])
      if (n === undefined) continue
      latestPerDay.set(d, n)
    }
    const result = Array.from(latestPerDay.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return result
  }, [filteredRows, metricKey, dateKey, groupKey, selectedGroupValue])

  const timeSeriesWithMA = useMemo(() => {
    const window = 7
    if (timeSeries.length === 0) return [] as { date: string; value: number; ma?: number }[]
    const vals = timeSeries.map((d) => d.value)
    const ma: (number | undefined)[] = []
    let run = 0
    for (let i = 0; i < vals.length; i++) {
      run += vals[i]
      if (i >= window) run -= vals[i - window]
      if (i >= window - 1) {
        ma.push(run / window)
      } else {
        ma.push(undefined)
      }
    }
    return timeSeries.map((d, i) => ({ ...d, ma: ma[i] }))
  }, [timeSeries])

  // scatter allPoints removed

  const histogram = useMemo(() => {
    if (!metricKey) return [] as { bin: string; count: number }[]
    const values = filteredRows
      .map((r) => coerceNumber(r[metricKey]))
      .filter((n): n is number => n !== undefined)
    if (values.length === 0) return []
    const min = Math.min(...values)
    const max = Math.max(...values)
    const bins = 20
    const step = (max - min) / bins || 1
    const counts = Array.from({ length: bins }, () => 0)
    for (const v of values) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)))
      counts[idx]++
    }
    return counts.map((c, i) => {
      const start = min + i * step
      const end = start + step
      return { bin: `${formatValue(start)}–${formatValue(end)}`, count: c }
    })
  }, [filteredRows, metricKey])

  const stats = useMemo(() => {
    if (!metricKey) return null as null | { count: number; min: number; max: number; mean: number; median: number; p95: number }
    const vals = filteredRows
      .map((r) => coerceNumber(r[metricKey]))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b)
    const count = vals.length
    if (count === 0) return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0 }
    const min = vals[0]
    const max = vals[count - 1]
    const mean = vals.reduce((a, b) => a + b, 0) / count
    const median = count % 2 ? vals[(count - 1) / 2] : (vals[count / 2 - 1] + vals[count / 2]) / 2
    const p95 = vals[Math.min(count - 1, Math.floor(count * 0.95))]
    return { count, min, max, mean, median, p95 }
  }, [filteredRows, metricKey])

  const topBottomGroups = useMemo(() => {
    if (!groupKey || !metricKey) return { top: [] as { label: string; value: number }[], bottom: [] as { label: string; value: number }[] }
    const groups = new Map<string, number[]>()
    for (const r of filteredRows) {
      const g = r[groupKey]
      if (!isString(g) || !g.trim()) continue
      const n = coerceNumber(r[metricKey])
      if (n === undefined) continue
      const arr = groups.get(g) ?? []
      arr.push(n)
      groups.set(g, arr)
    }
    const entries = Array.from(groups.entries()).map(([label, arr]) => ({
      label,
      value: arr.reduce((a, b) => a + b, 0) / arr.length,
    }))
    entries.sort((a, b) => b.value - a.value)
    return { top: entries.slice(0, 5), bottom: entries.slice(-5).reverse() }
  }, [filteredRows, groupKey, metricKey])
  return (
    <div className="page">
      <header className="header">
        <div className="titles">
          <h1>NYC Air Quality</h1>
          <p className="subtitle">
            Live data from NYC Open Data (
            <a
              href="https://data.cityofnewyork.us/Environment/Air-Quality/c3uy-2p5r"
              target="_blank"
              rel="noreferrer"
            >
              c3uy-2p5r
            </a>
            )
        </p>
      </div>
        <div className="actions">
          <input
            className="search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      {loading && <div className="state">Loading…</div>}
      {error && <div className="state error">Failed to load: {error}</div>}

      {!loading && !error && (
        <>
          <section className="kpis">
            <div className="kpi">
              <div className="kpi-value">{filteredRows.length.toLocaleString()}</div>
              <div className="kpi-label">Rows</div>
            </div>
            <div className="kpi">
              <div className="kpi-value">{allColumns.length}</div>
              <div className="kpi-label">Columns</div>
            </div>
            {groupKey && (
              <div className="kpi">
                <div className="kpi-value">{formatHeader(groupKey)}</div>
                <div className="kpi-label">Geography Name</div>
              </div>
            )}
            {/* metric hidden to simplify UI */}
          </section>

          {chartData.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">
                Top {chartData.length} Geography Name by Data Value
              </h2>
              <div style={{ width: '100%', height: 380 }}>
                <ResponsiveContainer>
                  <RBarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v: number) => formatValue(v)} />
                    <YAxis type="category" dataKey="label" width={160} />
                    <Tooltip formatter={(v: unknown) => formatValue(Number(v))} />
                    <Legend />
                    <Bar dataKey="value" fill="#4c8bf5" isAnimationActive animationDuration={700} radius={[8, 8, 8, 8]}>
                      <LabelList dataKey="value" position="insideRight" formatter={(v: unknown) => formatValue(Number(v))} />
                    </Bar>
                    <Brush dataKey="label" height={16} stroke="#8ab4f8" />
                  </RBarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="panel">
            <h2 className="panel-title">About this dataset</h2>
            <div className="about">
              <p>
                This dashboard uses NYC Open Data’s Air Quality dataset (<a href="https://data.cityofnewyork.us/Environment/Air-Quality/c3uy-2p5r" target="_blank" rel="noreferrer">c3uy-2p5r</a>). We use each geography’s most recent reported value for the Top 10 and Analysis sections, and raw daily values with a 7‑day moving average in the Trend chart.
              </p>
              <ul className="about-list">
                <li><b>Geography</b>: Identified by a geo ID/name (e.g., borough, neighborhood). This is the independent variable on the charts.</li>
                <li><b>Value</b>: The reported air quality measurement (e.g., AQI, PM2.5, NO₂). Higher values typically indicate worse air.</li>
                <li><b>Units</b>: AQI is unitless; PM2.5 is µg/m³; gases (NO₂/O₃/SO₂) are often ppb.</li>
              </ul>
              <p>
                The UI avoids metric/aggregation toggles to simplify interpretation: rankings are based on the latest reading per geography, and trends show connected daily values with a smoothed line to highlight direction over time.
              </p>
            </div>
          </section>

          {timeSeries.length > 1 && (
            <section className="panel">
              <div className="panel-header">
                <h2 className="panel-title">Trend over time · Data Value</h2>
                {groupKey && groupOptions.length > 0 && (
                  <div className="panel-actions">
                    <select
                      className="select"
                      value={selectedGroupValue}
                      onChange={(e) => setSelectedGroupValue(e.target.value)}
                    >
                      <option>All</option>
                      {groupOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ width: '100%', height: 360 }}>
                <ResponsiveContainer>
                  <RLineChart data={timeSeriesWithMA} margin={{ left: 16, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(v: number) => formatValue(v)} />
                    <Tooltip formatter={(v: unknown) => formatValue(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="value" name="Daily" stroke="#6aa7ff" strokeWidth={1.5} dot={false} connectNulls isAnimationActive animationDuration={600} />
                    <Line type="monotone" dataKey="ma" name="7‑day avg" stroke="#106be8" strokeWidth={2.5} dot={false} connectNulls isAnimationActive animationDuration={700} />
                    <Brush dataKey="date" height={16} stroke="#8ab4f8" />
                  </RLineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* All-points scatter removed for a cleaner presentation */}

          {histogram.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Distribution of Data Value</h2>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <RBarChart data={histogram} margin={{ left: 16, right: 8, top: 32, bottom: 64 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bin" interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip />
                    <Legend verticalAlign="top" align="right" height={24} />
                    <Bar dataKey="count" fill="#7bd389" isAnimationActive animationDuration={700} radius={[6, 6, 0, 0]} />
                  </RBarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {stats && (
            <section className="panel">
              <h2 className="panel-title">Analysis</h2>
              <div className="analysis-grid">
                <div className="stat-card">
                  <div className="stat-label">Count</div>
                  <div className="stat-value">{stats.count.toLocaleString()}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Min</div>
                  <div className="stat-value">{formatMetricLabel(stats.min, metricKey)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Median</div>
                  <div className="stat-value">{formatMetricLabel(stats.median, metricKey)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Mean</div>
                  <div className="stat-value">{formatMetricLabel(stats.mean, metricKey)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">95th %</div>
                  <div className="stat-value">{formatMetricLabel(stats.p95, metricKey)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Max</div>
                  <div className="stat-value">{formatMetricLabel(stats.max, metricKey)}</div>
                </div>
              </div>
              {groupKey && (
                <div className="analysis-sublists">
                  <div>
                    <h3 className="subhead">Top {topBottomGroups.top.length} by latest Data Value</h3>
                    <ul className="ranked-list">
                      {topBottomGroups.top.map((g, i) => (
                        <li key={g.label}>
                          <span className="rank">{i + 1}.</span> {g.label}
                          <span className="value">{formatValue(g.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="subhead">Bottom {topBottomGroups.bottom.length} by latest Data Value</h3>
                    <ul className="ranked-list">
                      {topBottomGroups.bottom.map((g, i) => (
                        <li key={g.label}>
                          <span className="rank">{i + 1}.</span> {g.label}
                          <span className="value">{formatValue(g.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="panel">
            <h2 className="panel-title">Data Preview</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {allColumns.map((c) => (
                      <th key={c}>{formatHeader(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr key={i}>
                      {allColumns.map((c) => (
                        <td key={c}>
                          {(() => {
                            const v = row[c]
                            if (v == null) return ''
                            if (isNumber(v)) return v
                            if (isString(v)) return v
                            try {
                              return JSON.stringify(v)
                            } catch {
                              return String(v)
                            }
                          })()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {hasMore && (
            <div className="load-more-wrap">
              <button className="load-more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Load more data'}
              </button>
              <div className="load-hint">Currently showing {rows.length.toLocaleString()} rows</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (Math.abs(n) >= 100) return n.toFixed(0)
  if (Math.abs(n) >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

function formatMetricLabel(n: number, metricKey?: string): string {
  const v = formatValue(n)
  if (!metricKey) return v
  const key = metricKey.toLowerCase()
  if (key.includes('aqi') || key.includes('air_quality_index')) return `${v} AQI`
  if (key.includes('pm') || key.includes('pm_2_5') || key.includes('pm25')) return `${v} µg/m³`
  if (key.includes('no2')) return `${v} ppb`
  if (key.includes('so2')) return `${v} ppb`
  if (key.includes('ozone') || key.includes('o3')) return `${v} ppb`
  return v
}

export default App
