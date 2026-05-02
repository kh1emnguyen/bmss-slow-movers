import { useMemo, useState, useRef, useEffect } from 'react'
import { data } from './data.js'

const ITEMS_PER_PAGE = 50

const MARGINS = {
  beer_cider_rtd: { single: 0.35, unit: 0.25 },
  wine:           { single: 0.30, unit: 0.30 },
  spirits:        { single: 0.15, unit: 0.15 },
}

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

function calcPromoSingle(cost, group) {
  if (!cost || cost <= 0) return null
  const raw = cost / (1 - MARGINS[group].single)
  return roundNearest49or99(raw)
}

function calcPromoUnit(cost, group, unitSize) {
  if (!cost || cost <= 0 || !unitSize) return null
  const raw = (cost * unitSize) / (1 - MARGINS[group].unit)
  return roundNearest49or99(raw)
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

function SlowMoversTab() {
  const [search,          setSearch]          = useState('')
  const [groupFilter,     setGroupFilter]     = useState('all')
  const [neverSoldOnly,   setNeverSoldOnly]   = useState(false)
  const [discountableOnly,setDiscountableOnly]= useState(false)
  const [showBelowFloor,  setShowBelowFloor]  = useState(false)
  const [sort,            setSort]            = useState({ field: 'stock_value_at_cost', dir: 'desc' })
  const [overrideCosts,   setOverrideCosts]   = useState({})
  const [page,            setPage]            = useState(1)
  const tableScrollRef = useRef(null)

  // ── Live promo helpers (cost-override aware) ──────────────────────────────

  const getEffCost    = (r) => overrideCosts[r.name] ?? r.cost
  const getPromoSingle= (r) => overrideCosts[r.name] != null ? calcPromoSingle(overrideCosts[r.name], r.group) : r.promo_single_price
  const getPromoUnit  = (r) => overrideCosts[r.name] != null ? calcPromoUnit(overrideCosts[r.name], r.group, r.unit_size) : r.promo_unit_price
  const getSingleStatus=(r) => overrideCosts[r.name] != null ? deriveStatus(r.current_single_price, getPromoSingle(r)) : r.single_status
  const getUnitStatus = (r) => overrideCosts[r.name] != null ? deriveStatus(r.current_unit_price,   getPromoUnit(r))   : r.unit_status

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
    let rows = data.rows

    if (!showBelowFloor) {
      rows = rows.filter(r => getSingleStatus(r) !== 'above_current')
    }
    if (groupFilter !== 'all')  rows = rows.filter(r => r.group === groupFilter)
    if (neverSoldOnly)          rows = rows.filter(r => r.never_sold)
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
  }, [search, groupFilter, neverSoldOnly, discountableOnly, showBelowFloor, sort, overrideCosts])

  // Reset page whenever filters change
  useEffect(() => setPage(1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, groupFilter, neverSoldOnly, discountableOnly, showBelowFloor, sort])

  const totalPages    = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const pageRows      = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const totalValue    = filtered.reduce((s, r) => s + r.stock_value_at_cost, 0)
  const belowFloorCt  = data.rows.filter(r => r.single_status === 'above_current').length

  return (
    <>
      {/* ── Stats strip ── */}
      <div className="stats-strip">
        <div className="stat">
          <div className="stat-label">Slow movers identified</div>
          <div className="stat-value warn">{data.rows.length}</div>
          <div className="stat-detail">{data.rows.filter(r => r.never_sold).length} never sold YTD</div>
        </div>
        <div className="stat">
          <div className="stat-label">Capital tied up</div>
          <div className="stat-value warn">
            ${Math.round(data.rows.reduce((s, r) => s + r.stock_value_at_cost, 0)).toLocaleString()}
          </div>
          <div className="stat-detail">at cost across {data.rows.length} SKUs</div>
        </div>
        <div className="stat">
          <div className="stat-label">Beer · Cider · RTD</div>
          <div className="stat-value">{data.rows.filter(r => r.group === 'beer_cider_rtd').length}</div>
          <div className="stat-detail">≤ 1 unit sold</div>
        </div>
        <div className="stat">
          <div className="stat-label">Wine</div>
          <div className="stat-value">{data.rows.filter(r => r.group === 'wine').length}</div>
          <div className="stat-detail">≤ 1 bottle sold</div>
        </div>
        <div className="stat">
          <div className="stat-label">Spirits</div>
          <div className="stat-value">{data.rows.filter(r => r.group === 'spirits').length}</div>
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
          <input type="checkbox" checked={neverSoldOnly}    onChange={e => setNeverSoldOnly(e.target.checked)} />
          <span className="toggle-label">Never sold only</span>
        </label>
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
            <strong>{filtered.length}</strong> of {data.rows.length} items shown
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
                    <SortableHeader label="Single promo" field="promo_single_price" sort={sort} setSort={setSort} />
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
                        className={[
                          r.never_sold   ? 'never-sold'    : '',
                          isBelowFloor   ? 'row-below-floor' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <td className="name">
                          {r.name}
                          {r.never_sold && <span className="never-sold-tag">0 sold</span>}
                        </td>
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
  const [tab, setTab] = useState('movers')
  return (
    <>
      <header className="masthead">
        <h1 className="masthead-title">BMSS<em> · Slow Movers Console</em></h1>
        <div className="masthead-meta">
          <div className="meta-row"><span>{data.meta.period}</span></div>
          <div className="meta-row">
            <strong>{data.rows.length}</strong>&nbsp;flagged ·&nbsp;
            <strong>{data.specials.length}</strong>&nbsp;specials
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab-button${tab === 'movers' ? ' active' : ''}`} onClick={() => setTab('movers')}>
          Slow Movers <span className="count">{data.rows.length}</span>
        </button>
        <button className={`tab-button${tab === 'specials' ? ' active' : ''}`} onClick={() => setTab('specials')}>
          Specials <span className="count">{data.specials.length}</span>
        </button>
      </nav>

      {tab === 'movers' ? <SlowMoversTab /> : <SpecialsTab />}

      <div className="rules-strip">
        <div className="rules-strip-item">
          <span className="rules-strip-label">Beer · Cider · RTD</span>
          <span className="rules-strip-value">single <strong>35%</strong> · unit <strong>25%</strong></span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Wine</span>
          <span className="rules-strip-value">single &amp; unit <strong>30%</strong></span>
        </div>
        <div className="rules-strip-item">
          <span className="rules-strip-label">Spirits</span>
          <span className="rules-strip-value">single &amp; unit <strong>15%</strong></span>
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
