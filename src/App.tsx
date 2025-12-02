import { useEffect, useMemo, useState } from 'react'
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

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        setLoading(true)
        setError(null)
        // Limit for performance; sort by newest if a time field exists server-side later
        const url = `${API_URL}?$limit=200`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as AnyRecord[]
        if (!cancelled) setRows(data)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  const allColumns = useMemo(() => {
    if (rows.length === 0) return []
    const keys = new Set<string>()
    for (const r of rows) {
      Object.keys(r).forEach((k) => keys.add(k))
    }
    return Array.from(keys)
  }, [rows])

  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows
    const needle = query.toLowerCase()
    return rows.filter((r) =>
      Object.values(r).some((v) => isString(v) && v.toLowerCase().includes(needle)),
    )
  }, [rows, query])

  const { groupKey, chartData } = useMemo(() => {
    // Prefer grouping by 'borough' if present; else first string column
    const preferred = allColumns.find((c) => c.toLowerCase() === 'borough')
    const stringCol =
      preferred ||
      allColumns.find((c) => filteredRows.some((r) => isString(r[c])))
    const key = stringCol
    if (!key) return { groupKey: undefined as string | undefined, chartData: [] as { label: string; value: number }[] }
    const counts = new Map<string, number>()
    for (const r of filteredRows) {
      const raw = r[key]
      if (isString(raw) && raw.trim()) {
        counts.set(raw, (counts.get(raw) ?? 0) + 1)
      }
    }
    const data = Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
    return { groupKey: key, chartData: data }
  }, [filteredRows, allColumns])

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
                <div className="kpi-value">{groupKey}</div>
                <div className="kpi-label">Grouped By</div>
              </div>
            )}
          </section>

          {chartData.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">
                Top {chartData.length} by {groupKey}
              </h2>
              <BarChart data={chartData} />
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
        </>
      )}
    </div>
  )
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const width = 900
  const barHeight = 32
  const gap = 10
  const height = data.length * (barHeight + gap) + 20
  const max = Math.max(...data.map((d) => d.value), 1)
  const leftAxis = 160
  const rightPadding = 24

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Bar chart"
    >
      {data.map((d, i) => {
        const y = i * (barHeight + gap) + 10
        const w = ((width - leftAxis - rightPadding) * d.value) / max
        return (
          <g key={d.label} transform={`translate(0, ${y})`}>
            <text x={0} y={barHeight * 0.75} className="bar-label">
              {d.label}
            </text>
            <rect
              x={leftAxis}
              y={0}
              width={Math.max(2, w)}
              height={barHeight}
              rx={8}
              className="bar-rect"
            />
            <text
              x={leftAxis + w + 8}
              y={barHeight * 0.7}
              className="bar-value"
            >
              {d.value.toLocaleString()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default App
