import { useMemo, useState, useRef, useEffect } from 'react'
import { data } from './data.js'

const ITEMS_PER_PAGE = 50

// Default (standard) margin floors — used as fallback
const MARGINS = {
  beer_cider_rtd: { single: 0.35, unit: 0.25 },
  wine:           { single: 0.30, unit: 0.30 },
  spirits:        { single: 0.15, unit: 0.15 },
}

// Two margin floor tiers — toggled from within the promo column header
// A = lower floors (more aggressive promos), B = tighter floors (more conservative)
const MARGIN_TIERS = [
  {
    label:          'A',
    desc:           'Beer 35/25 · Wine 25 · Spirits 15',
    beer_cider_rtd: { single: 0.35, unit: 0.25 },
    wine:           { single: 0.25, unit: 0.25 },
    spirits:        { single: 0.15, unit: 0.15 },
  },
  {
    label:          'B',
    desc:           'Beer 40/30 · Wine 30 · Spirits 20',
    beer_cider_rtd: { single: 0.40, unit: 0.30 },
    wine:           { single: 0.30, unit: 0.30 },
    spirits:        { single: 0.20, unit: 0.20 },
  },
]

// Permanently exclude items with zero sales (archaic — not sold since May 2025)
const ACTIVE_ROWS = data.rows.filter(r => !r.never_sold)

const fmt = {
  money: (n) =>
    n === null || n === undefined
      ? '—'
      : `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  num: (n) =>
    n === null || n === undefined
      ? '—'
      : Number.isInteger(n)
        ? n.toString()
        : n.toFixed(1),
}

// ── Rounding helpers ────────────────────────────────────────────────────────

/** Round to *nearest* .49 or .99 (used for manual cost overrides in the UI). */
function roundNearest49or99(price) {
  if (!price || price <= 0) return null
  const cents = price * 100
  const lo = Math.floor((cents + 1) / 50) * 50 - 1   // last .X9 ≤ price
  const hi = Math.ceil((cents + 1) / 50) * 50 - 1    // first .X9 ≥ price
  return Math.round(Math.abs(lo - cents) <= Math.abs(hi - cents) ? lo : hi) / 100
}

// ── Promo calculators (for live cost-override rows) ──────────────────────────

const MAX_SHELF_DISCOUNT = 0.20   // wine/spirits: promo never more than 20% off shelf

/** Apply 20%-off-shelf cap for wine/spirits. Beer is uncapped. */
function applyShelfCap(floor, shelfPrice, group) {
  if (!floor || !shelfPrice || group === 'beer_cider_rtd') return floor
  const minPromo = shelfPrice * (1 - MAX_SHELF_DISCOUNT)
  return floor < minPromo ? roundNearest49or99(minPromo) : floor
}

function calcPromoSingle(cost, group, shelfPrice, margins = MARGINS) {
  if (!cost || cost <= 0) return null
  const raw = cost / (1 - margins[group].single)
  const floor = roundNearest49or99(raw)
  return applyShelfCap(floor, shelfPrice, group)
}

function calcPromoUnit(cost, group, unitSize, shelfUnitPrice, margins = MARGINS) {
  if (!cost || cost <= 0 || !unitSize) return null
  const raw = (cost * unitSize) / (1 - margins[group].unit)
  const floor = roundNearest49or99(raw)
  return applyShelfCap(floor, shelfUnitPrice, group)
}

/** Score an item for promotion prominence (higher = better candidate). */
function promoScore(r, margins) {
  const promo = (!r.cost_missing && r.cost > 0)
    ? calcPromoSingle(r.cost, r.group, r.current_single_price, margins)
    : r.promo_single_price
  if (!promo || !r.current_single_price || promo >= r.current_single_price) return -Infinity
  const discountAmt = r.current_single_price - promo
  const discountPct = discountAmt / r.current_single_price
  return (
    r.stock_value_at_cost * 1.2 +
    discountAmt * 25 +
    discountPct * 300 +
    (r.transactions <= 1 ? 80 : (3 - Math.min(r.transactions, 3)) * 30) +
    r.total_on_hand * 1.5
  )
}

function deriveStatus(current, promo) {
  if (!promo)    return 'no_promo'
  if (!current)  return 'no_current_price'
  if (promo < current) return 'discount'
  if (promo === current) return 'at_floor'
  return 'above_current'
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  if (!status || status === 'no_promo' || status === 'no_current_price') return null
  const labels = { discount: 'Discount', at_floor: 'At floor', above_current: 'Below floor' }
  return <span className={`status-badge ${status}`}>{labels[status]}</span>
}

function SortableHeader({ label, field, sort, setSort }) {
  const active = sort.field === field
  return (
    <th
      className={active ? `sorted ${sort.dir}` : ''}
      onClick={() => setSort({ field, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
    >
      {label}
    </th>
  )
}

function Pagination({ page, totalPages, setPage }) {
  if (totalPages <= 1) return null
  const pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }
  return (
    <div className="pagination">
      <button className="page-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>←</button>
      {pages.map((p, i) =>
        typeof p === 'string'
          ? <span key={`el${i}`} className="page-ellipsis">{p}</span>
          : <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
      )}
      <button className="page-btn" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>→</button>
    </div>
  )
}

// ── Slow Movers tab ──────────────────────────────────────────────────────────

function SlowMoversTab({ activeMargins, marginTier, setMarginTier }) {
  const [search,          setSearch]          = useState('')
  const [groupFilter,     setGroupFilter]     = useState('all')
  const [discountableOnly,setDiscountableOnly]= useState(false)
  const [showBelowFloor,  setShowBelowFloor]  = useState(false)
  const [sort,            setSort]            = useState({ field: 'stock_value_at_cost', dir: 'desc' })
  const [overrideCosts,   setOverrideCosts]   = useState({})
  const [page,            setPage]            = useState(1)
  const tableScrollRef = useRef(null)

  // ── Live promo helpers — always calc from cost using active margins ────────

  const getEffCost = (r) => overrideCosts[r.name] ?? r.cost

  const getPromoSingle = (r) => {
    const cost = overrideCosts[r.name] ?? (r.cost_missing ? null : r.cost)
    if (cost != null && cost > 0) return calcPromoSingle(cost, r.group, r.current_single_price, activeMargins)
    return r.promo_single_price
  }
  const getPromoUnit = (r) => {
    const cost = overrideCosts[r.name] ?? (r.cost_missing ? null : r.cost)
    if (cost != null && cost > 0) return calcPromoUnit(cost, r.group, r.unit_size, r.current_unit_price, activeMargins)
    return r.promo_unit_price
  }
  const getSingleStatus = (r) => deriveStatus(r.current_single_price, getPromoSingle(r))
  const getUnitStatus   = (r) => deriveStatus(r.current_unit_price,   getPromoUnit(r))

  const handleCostChange = (name, val) => {
    const parsed = parseFloat(val)
    setOverrideCosts(prev => ({ ...prev, [name]: isNaN(parsed) ? 0 : parsed }))
  }

  // ── Horizontal scroll via vertical mouse-wheel ────────────────────────────

  useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const handler = (e) => {
      if (Math.abs(e.deltaX) === 0 && el.scrollWidth > el.clientWidth) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = ACTIVE_ROWS   // never_sold items already excluded

    if (!showBelowFloor) {
      rows = rows.filter(r => getSingleStatus(r) !== 'above_current')
    }
    if (groupFilter !== 'all')  rows = rows.filter(r => r.group === groupFilter)
    if (discountableOnly)       rows = rows.filter(r => getSingleStatus(r) === 'discount')
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
    }

    return [...rows].sort((a, b) => {
      const av = a[sort.field] ?? -Infinity
      const bv = b[sort.field] ?? -Infinity
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, groupFilter, discountableOnly, showBelowFloor, sort, overrideCosts, activeMargins])

  // Reset page whenever filters change
  useEffect(() => setPage(1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, groupFilter, discountableOnly, showBelowFloor, sort, activeMargins])

  const totalPages   = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const pageRows     = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const totalValue   = filtered.reduce((s, r) => s + r.stock_value_at_cost, 0)
  const belowFloorCt = ACTIVE_ROWS.filter(r => getSingleStatus(r) === 'above_current').length

  return (
    <>
      {/* ── Stats strip ── */}
      <div className="stats-strip">
        <div className="stat">
          <div className="stat-label">Active slow movers</div>
          <div className="stat-value warn">{ACTIVE_ROWS.length}</div>
          <div className="stat-detail">{data.rows.filter(r => r.never_sold).length} archaic excluded</div>
        </div>
        <div className="stat">
          <div className="stat-label">Capital tied up</div>
          <div className="stat-value warn">
            ${Math.round(ACTIVE_ROWS.reduce((s, r) => s + r.stock_value_at_cost, 0)).toLocaleString()}
          </div>
          <div className="stat-detail">at cost across {ACTIVE_ROWS.length} SKUs</div>
        </div>
        <div className="stat">
          <div className="stat-label">Beer · Cider · RTD</div>
          <div className="stat-value">{ACTIVE_ROWS.filter(r => r.group === 'beer_cider_rtd').length}</div>
          <div className="stat-detail">≤ 1 unit sold</div>
        </div>
        <div className="stat">
          <div className="stat-label">Wine</div>
          <div className="stat-value">{ACTIVE_ROWS.filter(r => r.group === 'wine').length}</div>
          <div className="stat-detail">≤ 1 bottle sold</div>
        </div>
        <div className="stat">
          <div className="stat-label">Spirits</div>
          <div className="stat-value">{ACTIVE_ROWS.filter(r => r.group === 'spirits').length}</div>
          <div className="stat-detail">≤ 1 bottle sold</div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Search</span>
          <input
            className="search-input"
            type="text"
            placeholder="name or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Group</span>
          {[['all','All'],['beer_cider_rtd','Beer/Cider/RTD'],['wine','Wine'],['spirits','Spirits']].map(([k,lbl]) => (
            <span key={k} className={`chip${groupFilter === k ? ' active' : ''}`} onClick={() => setGroupFilter(k)}>{lbl}</span>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={discountableOnly} onChange={e => setDiscountableOnly(e.target.checked)} />
          <span className="toggle-label">Discountable only</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showBelowFloor}   onChange={e => setShowBelowFloor(e.target.checked)} />
          <span className="toggle-label">Show below-floor items</span>
        </label>
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        <div className="results-meta">
          <span>
            <strong>{filtered.length}</strong> of {ACTIVE_ROWS.length} items shown
            {!showBelowFloor && belowFloorCt > 0 &&
              <span className="below-floor-note"> · {belowFloorCt} below-floor hidden</span>}
          </span>
          <span>stock value at cost · <strong>{fmt.money(totalValue)}</strong></span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No items match these filters.</div>
        ) : (
          <>
            <div className="table-scroll" ref={tableScrollRef}>
              <table>
                <thead>
                  <tr>
                    <SortableHeader label="Item"        field="name"                sort={sort} setSort={setSort} />
                    <SortableHeader label="Cat"         field="category"            sort={sort} setSort={setSort} />
                    <SortableHeader label="On hand"     field="total_on_hand"       sort={sort} setSort={setSort} />
                    <SortableHeader label="Stock $"     field="stock_value_at_cost" sort={sort} setSort={setSort} />
                    <SortableHeader label="Sold YTD"    field="transactions"        sort={sort} setSort={setSort} />
                    <th title="Edit to recalculate promo prices. Amber = suspect cost data.">Cost ✎</th>
                    <th>Single now</th>
                    <th
                      className={`promo-toggle-th${sort.field === 'promo_single_price' ? ` sorted ${sort.dir}` : ''}`}
                      onClick={e => { if (!e.target.closest('.tier-toggle')) setSort({ field: 'promo_single_price', dir: sort.field === 'promo_single_price' && sort.dir === 'desc' ? 'asc' : 'desc' }) }}
                    >
                      Single promo
                      <span className="tier-toggle" onClick={e => e.stopPropagation()}>
                        <button className={`tier-btn${marginTier === 0 ? ' active' : ''}`} onClick={() => setMarginTier(0)} title={MARGIN_TIERS[0].desc}>A</button>
                        <button className={`tier-btn${marginTier === 1 ? ' active' : ''}`} onClick={() => setMarginTier(1)} title={MARGIN_TIERS[1].desc}>B</button>
                      </span>
                    </th>
                    <th>Status</th>
                    <th>Unit (×n)</th>
                    <th>Unit now</th>
                    <SortableHeader label="Unit promo"  field="promo_unit_price"    sort={sort} setSort={setSort} />
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map(r => {
                    const promoSingle   = getPromoSingle(r)
                    const promoUnit     = getPromoUnit(r)
                    const singleStatus  = getSingleStatus(r)
                    const unitStatus    = getUnitStatus(r)
                    const isOverridden  = overrideCosts[r.name] != null
                    const isSuspect     = r.cost_missing && !isOverridden
                    const isBelowFloor  = singleStatus === 'above_current'

                    return (
                      <tr
                        key={r.name}
                        className={isBelowFloor ? 'row-below-floor' : ''}
                      >
                        <td className="name">{r.name}</td>
                        <td className="cat">{r.category}</td>
                        <td className="num">{r.total_on_hand}</td>
                        <td className="num">{fmt.money(r.stock_value_at_cost)}</td>
                        <td className="num">{r.transactions}</td>
                        <td className="num cost-cell">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className={`cost-input${isSuspect ? ' cost-suspect' : ''}${isOverridden ? ' cost-overridden' : ''}`}
                            value={overrideCosts[r.name] != null ? overrideCosts[r.name] : r.cost}
                            onChange={e => handleCostChange(r.name, e.target.value)}
                            title={isSuspect ? 'Suspect cost — enter correct value to calculate promo' : 'Edit cost to recalculate promo'}
                          />
                        </td>
                        <td className={`num ${r.current_single_price ? 'price-current' : 'price-na'}`}>
                          {r.current_single_price ? fmt.money(r.current_single_price) : 'n/a'}
                        </td>
                        <td className={`num ${promoSingle ? 'price-promo' : 'price-na'}`}>
                          {promoSingle ? fmt.money(promoSingle) : '—'}
                        </td>
                        <td className="num"><StatusBadge status={singleStatus} /></td>
                        <td className="num">{r.unit_size ? `×${r.unit_size}` : '—'}</td>
                        <td className={`num ${r.current_unit_price ? 'price-current' : 'price-na'}`}>
                          {r.current_unit_price ? fmt.money(r.current_unit_price) : 'n/a'}
                        </td>
                        <td className={`num ${promoUnit ? 'price-promo' : 'price-na'}`}>
                          {promoUnit ? fmt.money(promoUnit) : '—'}
                        </td>
                        <td className="num"><StatusBadge status={unitStatus} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} totalPages={totalPages} setPage={setPage} />

            <div className="page-info">
              Page {page} of {totalPages} · showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ── Promotions tab ───────────────────────────────────────────────────────────

const WELL_KNOWN = new Set([
  'Heineken','Asahi','Corona','Carlsberg','Stella','Singha','Tsing Tao',
  'Smirnoff','Bombay','Bacardi','Captain Morgan','Jameson','Glenfiddich',
  'Glenlivet','Macallan','Hennessy','Remy Martin','Martell','Patron',
  'Jose Cuervo','Don Julio','Penfolds','Wolf Blass','Yellow Tail','Wynns',
  'Brown Brothers','Jacobs Creek','Lindemans','Oyster Bay','Moet','Chandon',
  'Grey Goose','Belvedere','Tanqueray','Hendricks','Johnnie Walker',
  'Chivas','Ballantines','Buffalo Trace','Makers Mark','Woodford','Bumbu',
  'Kraken','Malibu','Aperol','Kahlua','Coopers','Great Northern',
])

function isWellKnown(name) {
  return [...WELL_KNOWN].some(b => name.toLowerCase().includes(b.toLowerCase()))
}

function buildJustification(r, promo, activeMargins) {
  const parts = []
  if (r.stock_value_at_cost >= 150)
    parts.push(`$${r.stock_value_at_cost.toFixed(0)} tied up at cost (${r.total_on_hand} units on shelf)`)
  if (r.transactions <= 2)
    parts.push(`Only ${r.transactions} transaction${r.transactions === 1 ? '' : 's'} Jan–Apr 2026 — barely moving`)
  if (promo && r.current_single_price) {
    const pct = ((r.current_single_price - promo) / r.current_single_price * 100).toFixed(0)
    parts.push(`${pct}% saving off shelf price — enough to drive impulse purchases`)
  }
  if (isWellKnown(r.name))
    parts.push(`Recognised brand — a visible discount should convert browser to buyer quickly`)
  if (r.group === 'wine' && r.cost >= 8)
    parts.push(`Mid-tier wine at $${r.cost.toFixed(2)} cost — shelf-talker plus discount typically resolves slow wine`)
  if (r.group === 'spirits' && r.cost >= 30)
    parts.push(`Premium spirit — even a modest promo at the margin floor is enough to trigger a trial purchase`)
  if (r.unit_size) {
    const up = calcPromoUnit(r.cost, r.group, r.unit_size, r.current_unit_price, activeMargins)
    if (up && r.current_unit_price) {
      const pct = ((r.current_unit_price - up) / r.current_unit_price * 100).toFixed(0)
      parts.push(`Case/pack deal: ${pct}% off at ${fmt.money(up)} for ×${r.unit_size} — good for regulars stocking up`)
    }
  }
  return parts.length ? parts : ['High stock value relative to sales velocity — prioritise for shelf promotion']
}

function PromoCard({ row, rank, activeMargins }) {
  const promo     = (!row.cost_missing && row.cost > 0)
    ? calcPromoSingle(row.cost, row.group, row.current_single_price, activeMargins)
    : row.promo_single_price
  const promoUnit = (!row.cost_missing && row.cost > 0 && row.unit_size)
    ? calcPromoUnit(row.cost, row.group, row.unit_size, row.current_unit_price, activeMargins)
    : row.promo_unit_price
  const discountPct = promo && row.current_single_price
    ? ((row.current_single_price - promo) / row.current_single_price * 100).toFixed(0)
    : null
  const reasons = buildJustification(row, promo, activeMargins)

  return (
    <div className="promo-card">
      <div className="promo-card-rank">#{rank}</div>
      <div className="promo-card-body">
        <div className="promo-card-name">{row.name}</div>
        <div className="promo-card-cat">{row.category}</div>
        <div className="promo-card-prices">
          <span className="promo-card-shelf">
            Shelf {fmt.money(row.current_single_price)}
          </span>
          <span className="promo-card-arrow">→</span>
          <span className="promo-card-promo">{fmt.money(promo)}</span>
          {discountPct && <span className="promo-card-pct">−{discountPct}%</span>}
          {promoUnit && row.unit_size &&
            <span className="promo-card-unit">· ×{row.unit_size} {fmt.money(promoUnit)}</span>}
        </div>
        <ul className="promo-card-reasons">
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    </div>
  )
}

function PromotionsTab({ activeMargins, marginTier, setMarginTier }) {
  const groups = [
    { key: 'beer_cider_rtd', label: 'Beer · Cider · RTD' },
    { key: 'wine',           label: 'Wine' },
    { key: 'spirits',        label: 'Spirits' },
  ]

  const topByGroup = useMemo(() =>
    Object.fromEntries(groups.map(({ key }) => {
      const scored = ACTIVE_ROWS
        .filter(r => r.group === key)
        .map(r => ({ r, score: promoScore(r, activeMargins) }))
        .filter(x => x.score > -Infinity)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(x => x.r)
      return [key, scored]
    })),
  [activeMargins])

  return (
    <div className="promotions-wrap">
      <div className="promotions-intro">
        <h2>Top Promotion Picks</h2>
        <p>
          The 10 highest-priority items per category — ranked by capital tied up,
          sales velocity, discount depth, and brand recognition.
          Prices reflect the active margin floor.
        </p>
        <div className="promo-floor-toggle">
          <span className="toolbar-label">Floor</span>
          {MARGIN_TIERS.map((t, i) => (
            <button key={i} className={`tier-btn${marginTier === i ? ' active' : ''}`} onClick={() => setMarginTier(i)} title={t.desc}>
              {t.label} <span className="tier-btn-desc">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="promotions-columns">
        {groups.map(({ key, label }) => (
          <div key={key} className="promotions-column">
            <div className="promotions-column-header">{label}</div>
            {topByGroup[key].length === 0
              ? <div className="empty">No discountable items in this group.</div>
              : topByGroup[key].map((r, i) => (
                  <PromoCard key={r.name} row={r} rank={i + 1} activeMargins={activeMargins} />
                ))
            }
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Weekly Tracker tab ────────────────────────────────────────────────────────

function TrackerTab() {
  const [groupFilter, setGroupFilter] = useState('all')
  const [search,      setSearch]      = useState('')
  const history = data.history || []

  // Per-item tracker data derived from history snapshots
  const trackerRows = useMemo(() => {
    const rows = ACTIVE_ROWS.filter(r => {
      if (groupFilter !== 'all' && r.group !== groupFilter) return false
      if (search.trim() && !r.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })

    return rows.map(r => {
      let implWeek = null
      let soldSinceImpl = 0
      const weeks = history.map(snap => {
        const item = snap.items?.[r.name]
        if (!item) return { date: snap.date, missing: true }
        if (item.implemented && !implWeek) implWeek = snap.date
        if (implWeek && item.units_sold) soldSinceImpl += item.units_sold
        return { date: snap.date, ...item }
      })
      return { ...r, weeks, implWeek, soldSinceImpl }
    })
  }, [groupFilter, search, history.length])

  const latestSnap    = history[history.length - 1]
  const implCount     = latestSnap ? Object.values(latestSnap.items || {}).filter(i => i.implemented).length : 0
  const totalTracked  = latestSnap ? Object.keys(latestSnap.items || {}).length : 0
  const totalSold     = trackerRows.reduce((s, r) => s + r.soldSinceImpl, 0)

  if (history.length === 0) {
    return (
      <div className="tracker-empty">
        <h2>No weekly snapshots yet</h2>
        <p>
          Every Thursday after exporting the new stocklist CSV, run:
        </p>
        <pre className="tracker-code">python scripts/analyze.py --pdf Sales.pdf --csv NewStocklist.csv</pre>
        <p>
          The script appends a snapshot to <code>data/history.json</code> — tracking
          which promos have been price-matched on the shelf and how many units
          have sold since implementation. Snapshots appear here and accumulate week-over-week.
        </p>
      </div>
    )
  }

  return (
    <div className="tracker-wrap">
      {/* ── Summary stats ── */}
      <div className="stats-strip">
        <div className="stat">
          <div className="stat-label">Weeks tracked</div>
          <div className="stat-value">{history.length}</div>
          <div className="stat-detail">since {history[0].date}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Promos implemented</div>
          <div className="stat-value good">{implCount}</div>
          <div className="stat-detail">of {totalTracked} items this week</div>
        </div>
        <div className="stat">
          <div className="stat-label">Not yet actioned</div>
          <div className="stat-value warn">{totalTracked - implCount}</div>
          <div className="stat-detail">still at old shelf price</div>
        </div>
        <div className="stat">
          <div className="stat-label">Units sold since tracking</div>
          <div className="stat-value">{totalSold}</div>
          <div className="stat-detail">across all tracked items</div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Search</span>
          <input className="search-input" type="text" placeholder="item name…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">Group</span>
          {[['all','All'],['beer_cider_rtd','Beer/Cider/RTD'],['wine','Wine'],['spirits','Spirits']].map(([k,lbl]) => (
            <span key={k} className={`chip${groupFilter === k ? ' active' : ''}`} onClick={() => setGroupFilter(k)}>{lbl}</span>
          ))}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="tracker-legend">
        <span className="tl-item tl-impl">✓ Price matched</span>
        <span className="tl-item tl-pending">○ Not yet actioned</span>
        <span className="tl-item tl-sold">↓ Units sold that week</span>
      </div>

      {/* ── Table ── */}
      <div className="table-wrap">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="tracker-name-th">Item</th>
                <th>Cat</th>
                <th>Promo $</th>
                {history.map(snap => (
                  <th key={snap.date} className="week-th">
                    {snap.date}<br/>
                    <span className="week-th-sub">stock · sold</span>
                  </th>
                ))}
                <th>Sold since impl</th>
              </tr>
            </thead>
            <tbody>
              {trackerRows.map(r => (
                <tr key={r.name} className={r.implWeek ? 'tracker-row-impl' : ''}>
                  <td className="name">{r.name}</td>
                  <td className="cat">{r.category}</td>
                  <td className="num price-promo">{fmt.money(r.promo_single_price)}</td>
                  {r.weeks.map((w, i) => {
                    if (w.missing) return <td key={i} className="tracker-na">—</td>
                    return (
                      <td key={i} className={`tracker-cell${w.implemented ? ' impl' : ' pending'}`}>
                        <div className="tracker-stock">{w.stock}</div>
                        {w.units_sold != null && w.units_sold > 0 &&
                          <div className="tracker-sold">↓{w.units_sold}</div>}
                        <div className={`tracker-status-dot ${w.implemented ? 'dot-impl' : 'dot-pending'}`} />
                      </td>
                    )
                  })}
                  <td className={`num ${r.soldSinceImpl > 0 ? 'tracker-sold-total' : 'price-na'}`}>
                    {r.soldSinceImpl > 0 ? r.soldSinceImpl : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Specials tab ─────────────────────────────────────────────────────────────

function ReasonNode({ reason, expanded, onToggle }) {
  return (
    <span className={`reason-node${expanded ? ' expanded' : ''}`} onClick={onToggle}>
      {reason.tag}
    </span>
  )
}

function SpecialCard({ special }) {
  const [expandedTag, setExpandedTag] = useState(null)
  const expandedReason = special.reasons.find(r => r.tag === expandedTag)
  return (
    <div className="special-card">
      <div className="special-card-header">
        <div className="special-name">{special.name}</div>
        <div className="special-cat">{special.category}</div>
      </div>
      <div className="special-meta">
        <div className="special-meta-item">
          <span className="special-meta-label">On hand</span>
          <span className="special-meta-value">{special.total_on_hand}</span>
        </div>
        <div className="special-meta-item">
          <span className="special-meta-label">Stock $</span>
          <span className="special-meta-value">{fmt.money(special.stock_value_at_cost)}</span>
        </div>
        <div className="special-meta-item">
          <span className="special-meta-label">Promo single</span>
          <span className="special-meta-value promo">
            {special.promo_single_price ? fmt.money(special.promo_single_price) : '—'}
          </span>
        </div>
        {special.promo_unit_price && (
          <div className="special-meta-item">
            <span className="special-meta-label">×{special.unit_size}</span>
            <span className="special-meta-value promo">{fmt.money(special.promo_unit_price)}</span>
          </div>
        )}
      </div>
      <div className="reasons">
        {special.reasons.map(reason => (
          <ReasonNode
            key={reason.tag}
            reason={reason}
            expanded={expandedTag === reason.tag}
            onToggle={() => setExpandedTag(expandedTag === reason.tag ? null : reason.tag)}
          />
        ))}
      </div>
      {expandedReason && <div className="reason-detail">{expandedReason.detail}</div>}
    </div>
  )
}

function SpecialsTab() {
  const [tagFilter,   setTagFilter]   = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')

  const allTags = useMemo(() => {
    const set = new Set()
    data.specials.forEach(s => s.reasons.forEach(r => set.add(r.tag)))
    return [...set].sort()
  }, [])

  const filtered = useMemo(() =>
    data.specials.filter(s => {
      if (groupFilter !== 'all' && s.group !== groupFilter) return false
      if (tagFilter   !== 'all' && !s.reasons.some(r => r.tag === tagFilter)) return false
      return true
    }),
    [tagFilter, groupFilter])

  return (
    <div className="specials-wrap">
      <div className="specials-intro">
        <h2>Specials worth highlighting</h2>
        <p>
          Items singled out beyond the standard slow-mover list — usually because
          there's a story attached: a recognisable brand that's gathering dust,
          significant capital tied up in one SKU, or stock that's only sold by the
          case when a single-bottle promo would shift it. Tap any node to read why
          it was flagged.
        </p>
      </div>

      <div className="specials-filters">
        <div className="toolbar-group">
          <span className="toolbar-label">Group</span>
          {[['all','All'],['beer_cider_rtd','Beer/Cider/RTD'],['wine','Wine'],['spirits','Spirits']].map(([k,lbl]) => (
            <span key={k} className={`chip${groupFilter === k ? ' active' : ''}`} onClick={() => setGroupFilter(k)}>{lbl}</span>
          ))}
        </div>
        <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
          <span className="toolbar-label">Reason</span>
          <span className={`chip${tagFilter === 'all' ? ' active' : ''}`} onClick={() => setTagFilter('all')}>
            All ({data.specials.length})
          </span>
          {allTags.map(tag => {
            const count = data.specials.filter(s => s.reasons.some(r => r.tag === tag)).length
            return (
              <span key={tag} className={`chip${tagFilter === tag ? ' active' : ''}`} onClick={() => setTagFilter(tag)}>
                {tag} ({count})
              </span>
            )
          })}
        </div>
      </div>

      <div className="results-meta">
        <span><strong>{filtered.length}</strong> specials</span>
      </div>

      {filtered.length === 0
        ? <div className="empty">Nothing matches this combination.</div>
        : <div className="specials-grid">{filtered.map(s => <SpecialCard key={s.name} special={s} />)}</div>}
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,        setTab]        = useState('movers')
  const [marginTier, setMarginTier] = useState(0)   // 0 = Floor A, 1 = Floor B

  const activeMargins = MARGIN_TIERS[marginTier]

  return (
    <>
      <header className="masthead">
        <h1 className="masthead-title">BMSS<em> · Slow Movers Console</em></h1>
        <div className="masthead-meta">
          <div className="meta-row"><span>{data.meta.period}</span></div>
          <div className="meta-row">
            <strong>{ACTIVE_ROWS.length}</strong>&nbsp;active ·&nbsp;
            <strong>{data.specials.length}</strong>&nbsp;specials
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab-button${tab === 'movers'   ? ' active' : ''}`} onClick={() => setTab('movers')}>
          Slow Movers <span className="count">{ACTIVE_ROWS.length}</span>
        </button>
        <button className={`tab-button${tab === 'promos'   ? ' active' : ''}`} onClick={() => setTab('promos')}>
          Top Picks
        </button>
        <button className={`tab-button${tab === 'tracker'  ? ' active' : ''}`} onClick={() => setTab('tracker')}>
          Weekly Tracker {(data.history || []).length > 0 && <span className="count">{(data.history || []).length}w</span>}
        </button>
        <button className={`tab-button${tab === 'specials' ? ' active' : ''}`} onClick={() => setTab('specials')}>
          Specials <span className="count">{data.specials.length}</span>
        </button>
      </nav>

      {tab === 'movers'   && <SlowMoversTab  activeMargins={activeMargins} marginTier={marginTier} setMarginTier={setMarginTier} />}
      {tab === 'promos'   && <PromotionsTab  activeMargins={activeMargins} marginTier={marginTier} setMarginTier={setMarginTier} />}
      {tab === 'tracker'  && <TrackerTab />}
      {tab === 'specials' && <SpecialsTab />}

      <div className="rules-strip">
        <div className="rules-strip-item">
          <span className="rules-strip-label">Floor {MARGIN_TIERS[marginTier].label} active</span>
          <span className="rules-strip-value">{MARGIN_TIERS[marginTier].desc}</span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Beer · Cider · RTD</span>
          <span className="rules-strip-value">
            single <strong>{(activeMargins.beer_cider_rtd.single * 100).toFixed(0)}%</strong>
            {' · '}unit <strong>{(activeMargins.beer_cider_rtd.unit * 100).toFixed(0)}%</strong>
          </span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Wine</span>
          <span className="rules-strip-value">single &amp; unit <strong>{(activeMargins.wine.single * 100).toFixed(0)}%</strong></span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Spirits</span>
          <span className="rules-strip-value">single &amp; unit <strong>{(activeMargins.spirits.single * 100).toFixed(0)}%</strong></span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Rounding</span>
          <span className="rules-strip-value">
            wine/spirits <strong>$X.49 / $X.99</strong> · beer <strong>$X.X9</strong>
          </span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Filter rule</span>
          <span className="rules-strip-value">sold <strong>≤ 1 unit</strong> Jan – Apr 26</span>
        </div>
      </div>
    </>
  )
}
