"""
update_stock.py  —  Thursday weekly stock refresh (no PDF needed)
─────────────────────────────────────────────────────────────────
Use this every Thursday instead of the full analyze.py when the
sales period hasn't changed (same PDF as last run).

What it does:
  1. Reads the new stocklist CSV (current prices + stock on hand)
  2. Loads existing src/data.js (keeps slow-mover classifications)
  3. Updates per-item: stock levels, current prices, status badges,
     promo savings, and stock value at cost
  4. Appends a new snapshot to data/history.json — tracking which
     promos have been price-matched and how many units sold this week
  5. Writes updated src/data.js (commit + deploy as usual)

Usage:
    python scripts/update_stock.py --csv path/to/NewStocklist.csv

    # Override snapshot date (defaults to today):
    python scripts/update_stock.py --csv path/to/NewStocklist.csv --date 2026-05-08
"""

import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import date as _date
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT    = Path(__file__).resolve().parent.parent
OUTPUT_JS    = REPO_ROOT / "src" / "data.js"
HISTORY_FILE = REPO_ROOT / "data" / "history.json"

# Reuse history helpers from analyze.py
PRICE_IMPL_TOLERANCE = 0.51


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_data_js(path):
    """Parse export const data = {...}; and return the dict."""
    text = Path(path).read_text(encoding="utf-8")
    m = re.match(r"export const data\s*=\s*(.+);\s*$", text, re.DOTALL)
    if not m:
        raise ValueError(f"Could not parse data.js at {path}")
    return json.loads(m.group(1))


def write_data_js(obj, path):
    Path(path).write_text(
        "export const data = " + json.dumps(obj, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )


def parse_stocklist(csv_path):
    """
    Returns dict[name] -> {cases_on_hand, items_on_hand, case_quantity, cost, tiers}
    Identical logic to analyze.py.
    """
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
                    "case_quantity": int(row.get("Case Quantity") or 0),
                    "cases_on_hand": int(float(row.get("Cases on hand") or 0)),
                    "items_on_hand": int(float(row.get("Items on hand") or 0)),
                    "cost":          cost,
                })
            items[name]["tiers"][qty] = price
    return dict(items)


def derive_status(current, promo):
    if promo is None:    return "no_promo"
    if current is None:  return "no_current_price"
    if promo < current:  return "discount"
    if promo == current: return "at_floor"
    return "above_current"


def is_implemented(price, promo):
    if price is None or promo is None:
        return False
    return abs(price - promo) <= PRICE_IMPL_TOLERANCE


def load_history(path):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"snapshots": []}


def save_history(history, path):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")


def annotate_units_sold(snapshots):
    for i in range(1, len(snapshots)):
        prev = snapshots[i - 1]["items"]
        curr = snapshots[i]["items"]
        for name, item in curr.items():
            p = prev.get(name)
            item["units_sold"] = max(0, p["stock"] - item["stock"]) if p else None
    return snapshots


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="BMSS weekly stock refresh")
    parser.add_argument("--csv",     required=True,           help="Path to new stocklist CSV")
    parser.add_argument("--out",     default=str(OUTPUT_JS),    help="Output data.js path")
    parser.add_argument("--history", default=str(HISTORY_FILE), help="Path to history.json")
    parser.add_argument("--date",    default=None,
                        help="Snapshot date YYYY-MM-DD (default: today)")
    args = parser.parse_args()

    snapshot_date = args.date or str(_date.today())

    # Load existing data
    print(f"→ Loading existing data.js from {args.out}…")
    existing = load_data_js(args.out)
    rows = existing["rows"]

    # Parse new stocklist
    print(f"→ Parsing new stocklist: {args.csv}…")
    stock = parse_stocklist(args.csv)

    updated = 0
    not_found = []

    for r in rows:
        name = r["name"]
        si   = stock.get(name)
        if si is None:
            not_found.append(name)
            continue

        # Refresh stock levels
        total_on_hand = si["cases_on_hand"] * si["case_quantity"] + si["items_on_hand"]
        r["cases_on_hand"]       = si["cases_on_hand"]
        r["items_on_hand"]       = si["items_on_hand"]
        r["total_on_hand"]       = total_on_hand
        r["stock_value_at_cost"] = round(total_on_hand * r["cost"], 2)

        # Refresh current prices from new tiers
        csp = si["tiers"].get(1)
        cup = si["tiers"].get(r["unit_size"]) if r.get("unit_size") else None
        r["current_single_price"] = csp
        r["current_unit_price"]   = cup

        # Refresh savings and status
        ps = r.get("promo_single_price")
        pu = r.get("promo_unit_price")
        r["promo_single_savings"] = round(csp - ps, 2) if (csp and ps) else None
        r["promo_unit_savings"]   = round(cup - pu, 2) if (cup and pu) else None
        r["single_status"]        = derive_status(csp, ps)
        r["unit_status"]          = derive_status(cup, pu)

        updated += 1

    print(f"  Updated : {updated} items")
    if not_found:
        print(f"  Not in new CSV ({len(not_found)}): {', '.join(not_found[:5])}"
              + (" …" if len(not_found) > 5 else ""))

    # Update specials prices too (same logic, just current prices)
    for s in existing.get("specials", []):
        si = stock.get(s["name"])
        if si:
            s["current_single_price"] = si["tiers"].get(1)
            s["current_unit_price"]   = si["tiers"].get(s.get("unit_size"))

    # ── History snapshot ──────────────────────────────────────────────────────
    history = load_history(args.history)

    if any(snap["date"] == snapshot_date for snap in history["snapshots"]):
        print(f"  History: snapshot for {snapshot_date} already exists — skipping.")
        print(f"           Use --date YYYY-MM-DD with a new date to force a new entry.")
    else:
        # Build snapshot from updated rows (exclude never_sold / archaic)
        snap_items = {}
        for r in rows:
            if r.get("never_sold"):
                continue
            snap_items[r["name"]] = {
                "stock":       r["total_on_hand"],
                "price":       r["current_single_price"],
                "promo":       r["promo_single_price"],
                "implemented": is_implemented(r["current_single_price"], r["promo_single_price"]),
                "units_sold":  None,
            }

        history["snapshots"].append({"date": snapshot_date, "items": snap_items})
        history["snapshots"] = annotate_units_sold(history["snapshots"])
        save_history(history, args.history)

        impl_ct = sum(1 for v in snap_items.values() if v["implemented"])
        print(f"  History: snapshot {snapshot_date} appended "
              f"({len(snap_items)} items, {impl_ct} promos implemented on shelf)")

    # Include history in data.js output
    existing["history"] = history["snapshots"]

    # ── Write ─────────────────────────────────────────────────────────────────
    write_data_js(existing, args.out)

    total_val = sum(r["stock_value_at_cost"] for r in rows)
    print(f"✓ data.js updated → {args.out}")
    print(f"  Stock value at cost : ${total_val:,.2f}")
    print(f"  Snapshots so far    : {len(history['snapshots'])}")


if __name__ == "__main__":
    main()
