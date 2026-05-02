"""
BMSS slow-mover analysis — updated rounding rules (May 2026)
─────────────────────────────────────────────────────────────
- Parses Sales_*.pdf for per-item sales metrics
- Parses *_Stocklist.csv for current stock + price tiers
- Joins by item name
- Flags slow-movers:
    * Beer/Cider/RTD/Soju  →  Calculated Cases Sold ≤ 1 unit
    * Wine/Spirits          →  Items Sold ≤ 1 AND Cases Sold ≤ 0
- Promo pricing:
    * Beer/Cider/RTD  →  round UP to nearest $X.X9
    * Wine / Spirits  →  round UP to nearest $X.49 or $X.99
- Items with cost < $0.50 are flagged as cost_missing (no promo generated)
- Picks "specials" with reason tags for the React dashboard
- Writes data.js (src/data.js) for the Vite/React app

Usage:
    pip install pdfplumber --break-system-packages -q
    python scripts/analyze.py --pdf path/to/Sales.pdf --csv path/to/Stocklist.csv
    # defaults to uploads/ if flags omitted
"""

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

import pdfplumber

# ── Defaults (for Claude/StackBlitz workflow) ─────────────────────────────────
UPLOADS    = Path("/mnt/user-data/uploads")
PDF_PATH   = UPLOADS / "Sales_Jan-Apr_26.pdf"
CSV_PATH   = UPLOADS / "Apr26_Stocklist.csv"
OUTPUT_JS  = Path("src/data.js")

# Items with cost below this threshold are treated as missing data
COST_MISSING_THRESHOLD = 0.50


# ── Sales PDF parsing ─────────────────────────────────────────────────────────

def parse_sales_pdf(pdf_path):
    """Returns dict[name] -> {revenue, cogs, transactions, profit_pct, cases_sold, items_sold}."""
    sales = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            for line in text.split("\n"):
                if "Revenue" in line and "Cost of Goods Sold" in line:
                    continue
                if "Sales by Product" in line or "Bottlemart" in line:
                    continue
                if line.strip().startswith("01/01/2026") or line.strip().startswith("Name"):
                    continue
                if line.strip().startswith("$"):
                    continue
                m = re.match(
                    r"^(.+?)\s+(-?\$[\d,]+\.\d+)\s+(-?\$[\d,]+\.\d+)\s+(-?\d+)\s+(-?\d+\.\d+)%\s+(-?\d+)\s+(-?[\d.]+)\s*$",
                    line.strip(),
                )
                if not m:
                    continue
                name = m.group(1).strip()
                sales[name] = {
                    "revenue":      float(m.group(2).replace("$", "").replace(",", "")),
                    "cogs":         float(m.group(3).replace("$", "").replace(",", "")),
                    "transactions": int(m.group(4)),
                    "profit_pct":   float(m.group(5)),
                    "cases_sold":   int(m.group(6)),
                    "items_sold":   float(m.group(7)),
                }
    return sales


# ── Stocklist CSV parsing ─────────────────────────────────────────────────────

def parse_stocklist(csv_path):
    items = defaultdict(lambda: {"tiers": {}})
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row["Name"].strip()
            try:
                qty   = int(row["Quantity"])
                price = float(row["Price"])
                cost  = float(row["Cost"])
            except (ValueError, KeyError):
                continue
            if not items[name]["tiers"]:
                items[name].update({
                    "category":      row["Category"].strip(),
                    "case_quantity": int(row.get("Case Quantity") or 0),
                    "cases_on_hand": int(float(row.get("Cases on hand") or 0)),
                    "items_on_hand": int(float(row.get("Items on hand") or 0)),
                    "cost":          cost,
                })
            items[name]["tiers"][qty] = price
    return dict(items)


# ── Category classification ───────────────────────────────────────────────────

BEER_CIDER_RTD = {
    "Beer Craft", "Beer International", "Beer Local", "Beer Kegs",
    "Non-Alcoholic Beer", "Cider", "RTD", "Soju",
}
WINE = {
    "Wine Red", "Wine White", "Wine Rose", "Moscato",
    "Sparkling & Champagne", "Cask & Port",
}
SPIRITS = {
    "Asian Spirits", "Blended Scotch Whisky", "Bourbon", "Brandy",
    "Canadian Whisky", "Cheap Spirits", "Cognac", "Gin", "Irish Whisky",
    "Japanese Whisky", "Liqueur", "Miniatures", "Rum",
    "Single Malt Whisky - Scotch", "Spirits", "Tequila", "Vodka", "Whiskey",
}
EXCLUDE = {"Snack Foods", "Soft Drinks", "Smokes", "Accessories", " Lime and Soda", ""}


def classify(category):
    if category in BEER_CIDER_RTD: return "beer_cider_rtd"
    if category in WINE:           return "wine"
    if category in SPIRITS:        return "spirits"
    return None


# ── Pricing ───────────────────────────────────────────────────────────────────

MARGINS = {
    "beer_cider_rtd": (0.35, 0.25),
    "wine":           (0.30, 0.30),
    "spirits":        (0.15, 0.15),
}


def round_up_49_or_99(raw):
    """Round UP to nearest $X.49 or $X.99. For wine and spirits."""
    if raw is None or raw <= 0:
        return None
    cents = raw * 100
    n = math.ceil((cents + 1) / 50)
    return round((50 * n - 1) / 100, 2)


def round_up_x9(raw):
    """Round UP to nearest cent ending in 9 (e.g. $3.59, $4.09). For beer/cider/RTD."""
    if raw is None or raw <= 0:
        return None
    cents = math.ceil(raw * 100)
    last = cents % 10
    if last < 9:
        cents += 9 - last
    elif last > 9:
        cents = (cents // 10 + 1) * 10 - 1
    return round(cents / 100, 2)


def promo_price(cost_per_unit, margin, group):
    """
    cost / (1 − margin), rounded up to the group-appropriate price point.
    Returns None if cost is missing/suspect (< COST_MISSING_THRESHOLD).
    """
    if cost_per_unit is None or cost_per_unit < COST_MISSING_THRESHOLD:
        return None
    raw = cost_per_unit / (1 - margin)
    return round_up_x9(raw) if group == "beer_cider_rtd" else round_up_49_or_99(raw)


def pick_unit_size(tiers, group):
    multis = sorted(q for q in tiers if q > 1)
    if not multis:
        return None
    if group == "beer_cider_rtd":
        for p in (6, 4, 8, 10, 24, 30):
            if p in tiers: return p
    if group in ("wine", "spirits"):
        for p in (6, 12, 2):
            if p in tiers: return p
    return multis[0]


# ── Slow-mover criteria ───────────────────────────────────────────────────────

def is_slow_mover(group, sale, case_quantity, unit_size):
    if group == "beer_cider_rtd":
        total = sale["cases_sold"] * (case_quantity or 1) + sale["items_sold"]
        return (total / unit_size <= 1) if unit_size else (total <= 6)
    if group in ("wine", "spirits"):
        return sale["items_sold"] <= 1 and sale["cases_sold"] <= 0
    return False


# ── Build dataset ─────────────────────────────────────────────────────────────

def build_dataset(pdf_path, csv_path):
    sales = parse_sales_pdf(pdf_path)
    stock = parse_stocklist(csv_path)

    rows, matched, unmatched = [], 0, 0
    ZERO_SALE = {"revenue": 0.0, "cogs": 0.0, "transactions": 0,
                 "profit_pct": 0.0, "cases_sold": 0, "items_sold": 0.0}

    for name, si in stock.items():
        category = si["category"]
        if category in EXCLUDE:
            continue
        group = classify(category)
        if group is None:
            continue

        sale = sales.get(name)
        if sale is None:
            sale = dict(ZERO_SALE)
            unmatched += 1
        else:
            matched += 1

        cost        = si["cost"]
        unit_size   = pick_unit_size(si["tiers"], group)
        csp         = si["tiers"].get(1)
        cup         = si["tiers"].get(unit_size) if unit_size else None

        if not is_slow_mover(group, sale, si["case_quantity"], unit_size):
            continue

        single_margin, unit_margin = MARGINS[group]
        p_single = promo_price(cost, single_margin, group)
        p_unit   = promo_price(cost * unit_size, unit_margin, group) if unit_size else None

        total_on_hand = si["cases_on_hand"] * si["case_quantity"] + si["items_on_hand"]

        def ds(current, promo):
            if promo is None:    return "no_current_price" if current is None else "no_promo"
            if current is None:  return "no_current_price"
            if promo < current:  return "discount"
            if promo == current: return "at_floor"
            return "above_current"

        rows.append({
            "name":                 name,
            "category":             category,
            "group":                group,
            "cost":                 cost,
            "case_quantity":        si["case_quantity"],
            "unit_size":            unit_size,
            "cases_on_hand":        si["cases_on_hand"],
            "items_on_hand":        si["items_on_hand"],
            "total_on_hand":        total_on_hand,
            "stock_value_at_cost":  round(total_on_hand * cost, 2),
            "current_single_price": csp,
            "current_unit_price":   cup,
            "promo_single_price":   p_single,
            "promo_unit_price":     p_unit,
            "promo_single_savings": round(csp - p_single, 2) if (csp and p_single) else None,
            "promo_unit_savings":   round(cup - p_unit,   2) if (cup and p_unit)   else None,
            "single_status":        ds(csp, p_single),
            "unit_status":          ds(cup, p_unit),
            "revenue_ytd":          sale["revenue"],
            "transactions":         sale["transactions"],
            "cases_sold":           sale["cases_sold"],
            "items_sold":           sale["items_sold"],
            "never_sold":           sale["transactions"] == 0,
            "cost_missing":         cost < COST_MISSING_THRESHOLD,
        })

    return rows, matched, unmatched


# ── Specials selection ────────────────────────────────────────────────────────

WELL_KNOWN = [
    "Heineken","Asahi","Corona","Carlsberg","Stella","Singha","Tsing Tao",
    "Smirnoff","Bombay","Bacardi","Captain Morgan","Jameson","Glenfiddich",
    "Glenlivet","Macallan","Hennessy","Remy Martin","Martell","Patron",
    "Jose Cuervo","Don Julio","Penfolds","Wolf Blass","Yellow Tail","Wynns",
    "Brown Brothers","Jacobs Creek","Lindemans","Oyster Bay","Moet","Chandon",
    "Grey Goose","Belvedere","Skyy","Tanqueray","Hendricks","Johnnie Walker",
    "Chivas","Ballantines","Buffalo Trace","Makers Mark","Woodford","Bumbu",
    "Kraken","Malibu","Pimms","Aperol","Kahlua",
]


def pick_specials(rows):
    specials = []
    for r in rows:
        reasons = []

        if any(b.lower() in r["name"].lower() for b in WELL_KNOWN):
            if r["never_sold"]:
                reasons.append({"tag": "Brand-name dead stock", "detail":
                    f"{r['name']} is a recognised brand but recorded ZERO transactions Jan–Apr. "
                    f"Either shelf placement is wrong or it's been overshadowed by a faster substitute. "
                    f"A visible discount should clear it quickly."})
            elif r["transactions"] <= 3:
                reasons.append({"tag": "Underperforming brand", "detail":
                    f"Only {r['transactions']} transactions YTD despite being a name customers know. "
                    f"Probably a positioning problem — promote it to test demand."})

        if r["stock_value_at_cost"] >= 200:
            reasons.append({"tag": "Capital tied up", "detail":
                f"${r['stock_value_at_cost']:.2f} of stock at cost sitting on the shelf "
                f"({r['total_on_hand']} units). Discounting frees working capital faster than organic sales."})

        if r["group"] == "spirits" and r["cost"] >= 50 and r["never_sold"]:
            reasons.append({"tag": "Premium spirit not moving", "detail":
                f"Cost ${r['cost']:.2f}/bottle but no buyers YTD. A modest single-bottle promo "
                f"at the 15% margin floor may convert curiosity into a sale."})

        if r["group"] == "wine" and r["never_sold"] and r["cost"] >= 8:
            reasons.append({"tag": "Cellar-grade wine, no traction", "detail":
                f"Mid-tier wine (${r['cost']:.2f} cost) with zero sales. A shelf-talker plus "
                f"the discounted price often resolves this."})

        if r.get("promo_single_price"):
            if r["group"] == "beer_cider_rtd" and r["promo_single_price"] <= 5.99:
                unit_note = (f"Pair with ×{r['unit_size']} at {fmt_m(r['promo_unit_price'])} for fridge-front."
                             if r.get("promo_unit_price") else "Worth a fridge-front spot.")
                reasons.append({"tag": "Sub-$6 single beer promo", "detail":
                    f"At {fmt_m(r['promo_single_price'])}/single this beats most impulse-buy thresholds. {unit_note}"})
            if r["group"] == "wine" and r["promo_single_price"] <= 9.99:
                reasons.append({"tag": "Sub-$10 single bottle wine", "detail":
                    f"At {fmt_m(r['promo_single_price'])} this falls into impulse-buy territory. "
                    f"Position near the entrance with a 'staff pick' card."})

        if r["current_single_price"] is None:
            note = (f"Adding a single-bottle promo at {fmt_m(r['promo_single_price'])} may unlock movement."
                    if r.get("promo_single_price") else "")
            reasons.append({"tag": "Only listed as case purchase", "detail":
                f"No single-bottle price tier — kills impulse purchases. {note}".strip()})

        if reasons:
            reasons_copy = dict(r)
            reasons_copy["reasons"] = reasons
            specials.append(reasons_copy)

    specials.sort(key=lambda x: x["stock_value_at_cost"], reverse=True)
    return specials


def fmt_m(n):
    return f"${n:.2f}" if n else "—"


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="BMSS slow-mover analysis")
    parser.add_argument("--pdf", default=str(PDF_PATH), help="Path to sales PDF")
    parser.add_argument("--csv", default=str(CSV_PATH), help="Path to stocklist CSV")
    parser.add_argument("--out", default=str(OUTPUT_JS), help="Output data.js path")
    parser.add_argument("--period", default="01/01/2026 – 25/04/2026", help="Period label")
    args = parser.parse_args()

    rows, matched, unmatched = build_dataset(args.pdf, args.csv)
    specials = pick_specials(rows)

    out = {
        "meta": {
            "period": args.period,
            "total_slow_movers": len(rows),
            "matched_with_sales": matched,
            "never_sold_in_period": sum(1 for r in rows if r["never_sold"]),
            "specials_count": len(specials),
            "rules": {
                "beer_cider_rtd": {"filter": "Calculated Cases Sold ≤ 1", "single_margin": 0.35, "unit_margin": 0.25},
                "wine":           {"filter": "Items Sold ≤ 1 AND Cases Sold ≤ 0", "single_margin": 0.30, "unit_margin": 0.30},
                "spirits":        {"filter": "Items Sold ≤ 1 AND Cases Sold ≤ 0", "single_margin": 0.15, "unit_margin": 0.15},
                "rounding":       "Beer/RTD → $X.X9 · Wine/Spirits → $X.49 or $X.99",
            },
        },
        "rows": rows,
        "specials": specials,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("export const data = " + json.dumps(out, indent=2, ensure_ascii=False) + ";\n")

    print(f"✓ {len(rows)} slow movers written to {out_path}")
    print(f"  Beer/Cider/RTD : {sum(1 for r in rows if r['group']=='beer_cider_rtd')}")
    print(f"  Wine           : {sum(1 for r in rows if r['group']=='wine')}")
    print(f"  Spirits        : {sum(1 for r in rows if r['group']=='spirits')}")
    print(f"  Never sold     : {sum(1 for r in rows if r['never_sold'])}")
    print(f"  Cost missing   : {sum(1 for r in rows if r['cost_missing'])}")
    print(f"  Specials       : {len(specials)}")
    print(f"  Stock at cost  : ${sum(r['stock_value_at_cost'] for r in rows):,.2f}")


if __name__ == "__main__":
    main()
