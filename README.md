# BMSS Slow Movers Console

A Vite + React dashboard for Bottlemart Sunshine that identifies slow-moving stock, generates margin-floor promo prices, and tracks week-over-week whether those promos have been implemented and are actually shifting units.

Live: **https://kh1emnguyen.github.io/bmss-slow-movers/**

---

## ⚠️ Resuming on home desktop — read this first

**Last worked on: 2 May 2026, BMSS desktop.**
All code changes are complete and saved to the folder. The app has NOT been deployed to GitHub yet — that's the only remaining step.

### What's done ✅
- All source code updated (`src/App.jsx`, `src/styles.css`, `scripts/analyze.py`, `scripts/update_stock.py`)
- `src/data.js` refreshed with the 2 May 2026 stocklist (293 items, $23,708 stock at cost)
- `data/history.json` has the first weekly snapshot (103 items tracked, 25 promos already on shelf)
- Git infra scripts written (`scripts/git-sync.sh`, `scripts/watch.js`, `scripts/install-hooks.sh`)

### What still needs doing ❌
1. **Transfer this folder** to home desktop (USB drive, zip to email, or cloud sync — the whole `bmss-slow-movers-main` folder)
2. **Install Node.js** on home desktop if not already: https://nodejs.org (get the LTS `.msi` installer)
3. **Delete and reinstall node_modules** — the existing one is corrupted from an interrupted install:
   ```bash
   cd /c/Users/<you>/path/to/bmss-slow-movers-main
   rm -rf node_modules
   npm install
   ```
4. **Create `config.json`** with your GitHub PAT (token):
   ```bash
   cp config.json.example config.json
   # Then open config.json and paste your fine-grained GitHub token
   ```
   Get a new token at: https://github.com/settings/tokens → Fine-grained → repo `kh1emnguyen/bmss-slow-movers` → Contents: read+write
5. **Install the post-commit hook:**
   ```bash
   npm run setup
   ```
6. **Push source + deploy:**
   ```bash
   bash scripts/git-sync.sh push "feat: tracker tab, margin toggle, weekly history"
   bash scripts/git-sync.sh deploy
   ```
   First deploy? After it finishes go to:
   **GitHub → repo Settings → Pages → Source → gh-pages branch → / (root) → Save**

### Key features added since last deploy
- **Margin floor A/B toggle** — now lives inside the "Single promo" column header, not a separate bar
- **Weekly Tracker tab** — shows week-over-week stock levels, whether promos are on shelf, units sold since implementation
- **Archaic items excluded** — never-sold items permanently filtered out
- **Top Picks tab** — top 10 promo candidates per category with justification
- **`scripts/update_stock.py`** — Thursday weekly command (no PDF needed, just the new stocklist CSV)

### Thursday workflow going forward
```bash
python scripts/update_stock.py --csv "path/to/NewStocklist.csv"
bash scripts/git-sync.sh push "week: YYYY-MM-DD"
bash scripts/git-sync.sh deploy
```

---

---

## Thursday Workflow

Every Thursday, export two files from your POS/inventory system and run one command.

### 1 — Export the files

| File | What to export | Notes |
|---|---|---|
| **Sales PDF** | Sales-by-Product report (full YTD period) | Pass path with `--pdf` |
| **Stocklist CSV** | Current inventory: stock-on-hand, current prices, cost | Pass path with `--csv` |

The stocklist must include: `Name`, `Category`, `Quantity`, `Price`, `Cost`, `Case Quantity`, `Cases on hand`, `Items on hand`.

### 2 — Run the analysis

```bash
cd /c/Users/Register/Downloads/bmss-slow-movers-main

python scripts/analyze.py \
  --pdf  "path/to/Sales_YTD.pdf" \
  --csv  "path/to/Thu_Stocklist.csv" \
  --period "01/01/2026 – 01/05/2026"
```

The script will:
- Re-identify all slow movers from the latest data
- Regenerate recommended promo prices (margin-floor + 20%-off-shelf cap)
- **Append a weekly snapshot** to `data/history.json` — recording stock levels, shelf prices, and whether each promo has been price-matched on the shelf
- Calculate **units sold since last Thursday** (`prev_stock − curr_stock` per item)
- Write `src/data.js` with all the above, including full history

### 3 — Commit and deploy

```bash
bash scripts/git-sync.sh push "week: YYYY-MM-DD"
bash scripts/git-sync.sh deploy
```

Or just save any file in `src/` while `npm run watch` is running — the watcher auto-commits and the post-commit hook auto-deploys.

---

## Weekly Tracker tab

The **Weekly Tracker** tab shows a table where:

- **Rows** = every active slow mover (never-sold / archaic items excluded)
- **Columns** = one per Thursday snapshot
- Each cell shows: **stock on hand** · **units sold** that week · **● green** (price matched on shelf) or **● grey** (not yet actioned)
- **Sold since impl** column = total units moved from the first week the promo was implemented

### What "implemented" means

An item is marked implemented when its current shelf price is within **$0.51** of the recommended promo. This tolerance covers rounding without false positives.

### Units sold calculation

```
units_sold = max(0, prev_stock − curr_stock)
```

If stock goes up (a delivery landed), that week shows 0 sold. Conservative but avoids inflating numbers — real sold units appear the following Thursday once the delivery is absorbed.

---

## Margin floor tiers

The **Single promo** column header has an **A / B** toggle. Switching recalculates all prices live:

| Tier | Beer · Cider · RTD | Wine | Spirits |
|---|---|---|---|
| **A** — aggressive | single 35% · unit 25% | 25% | 15% |
| **B** — conservative | single 40% · unit 30% | 30% | 20% |

Hard cap: wine and spirits promos never exceed **20% off shelf**, regardless of floor — prevents stale cost data producing absurd prices.

---

## First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Install the post-commit auto-deploy hook
npm run setup

# 3. Create config.json (gitignored — contains your GitHub PAT)
cp config.json.example config.json
# Edit config.json — fill in your fine-grained GitHub token

# 4. Initial push + deploy
bash scripts/git-sync.sh push "init"
bash scripts/git-sync.sh deploy
```

After setup, run `npm run watch` — any save to `src/` auto-commits and deploys to GitHub Pages.

---

## Slow-mover criteria

| Group | Threshold |
|---|---|
| Beer · Cider · RTD · Soju | Calculated cases sold ≤ 1 unit over the period |
| Wine · Spirits | Items sold ≤ 1 AND cases sold ≤ 0 |

**Archaic items** (zero transactions since May 2025) are permanently excluded — return to supplier or write off rather than promote.

**Suspect cost** (cost < $0.50) flagged amber — enter the correct cost to unlock a valid promo price.

---

## Project structure

```
bmss-slow-movers-main/
├── src/
│   ├── App.jsx          React dashboard
│   ├── data.js          Generated — do not edit by hand
│   └── styles.css
├── data/
│   └── history.json     Weekly snapshots — committed each Thursday
├── scripts/
│   ├── analyze.py       Main script — run every Thursday
│   ├── git-sync.sh      push / pull / deploy helper
│   ├── watch.js         File watcher (auto-commit on src/ save)
│   ├── post-commit.sh   Git hook (auto-deploy on commit to main)
│   └── install-hooks.sh Run once to install the hook
├── config.json          YOUR TOKEN — gitignored, never commit
└── config.json.example  Token template
```
