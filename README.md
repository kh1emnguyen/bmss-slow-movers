# BMSS Slow Movers Console

A two-tab interactive React dashboard for identifying slow-moving stock at Bottlemart Sunshine and recommending promotional pricing that maintains category-specific margin floors.

## What this is

Built from the **Sales by Product (Jan – Apr 2026)** report and the **April current stocklist**.

- **Tab 1 — Slow Movers**: every SKU in beer/cider/RTD, wine, or spirits that sold ≤ 1 unit in the period, with current price, recommended promo price (single + multi-pack), and a discount-status badge.
- **Tab 2 — Specials**: a curated subset with clickable reason nodes — capital tied up, recognisable brand sitting dead, no single-bottle tier killing impulse buys, etc.

## Pricing rules baked in

| Group | Single margin | Unit margin |
|---|---|---|
| Beer · Cider · RTD · Soju | 35% | 25% |
| Wine (red, white, rose, moscato, sparkling, cask) | 30% | 30% |
| Spirits (all) | 15% | 15% |

All prices are rounded **up** to the nearest `$X.X9` to maintain the margin floor.

## Slow-mover criteria

- **Beer/Cider/RTD/Soju**: total individual cans/bottles sold (`cases × case_qty + items`), divided by the unit (multi-pack) size, must be **≤ 1 unit**.
- **Wine/Spirits**: `Items Sold ≤ 1` AND `Cases Sold ≤ 0`.

The Singha 4-pack-cans example (0 cases sold + 4 individual cans = 0.67 units) was the calibration case.

## Status badges

| Badge | Meaning |
|---|---|
| **Discount** | Promo price is below current shelf price |
| **At floor** | Promo price equals current — already at the margin floor |
| **Below floor** | Current price is *already* below the margin floor — discounting further loses money |

## Running on StackBlitz

1. Go to <https://stackblitz.com/fork/vite-react>
2. Replace these files with the ones in this folder:
   - `package.json`
   - `vite.config.js`
   - `index.html`
   - `src/main.jsx`
   - `src/App.jsx`
   - `src/data.js`
   - `src/styles.css`
3. StackBlitz auto-installs and serves it.

Alternatively, drag-and-drop this folder into a new StackBlitz Vite project.

## Running locally

```bash
npm install
npm run dev
```

## Refreshing the data

The data lives in `src/data.js`. To regenerate from a new sales report and stocklist, run the analysis pipeline driven by the `bmss-slow-mover-promo` skill — that produces a fresh `slow_movers.json` and rewrites `src/data.js`.
