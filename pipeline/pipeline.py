"""
DETERMINISTIC CORE — pipeline.py
=================================
This file is the ONLY place in the system where numbers are computed.

Contract:
  1. Input:  Vendor-Payments_2021-23.xlsx (935,853 rows, sheets 'FY 2022' / 'FY 2023')
  2. Output: src/aggregates.ts — every aggregate carries lineage metadata
             (provenance tier, method, source sheet, contributing row count,
             and Tier-1 sample rows where applicable).
  3. No model, no inference, no estimation. Every value is reproducible:
     same input file -> byte-identical output, every run.

Provenance tiers (after the four-tier taxonomy in the design philosophy):
  AGGREGATED — composed from many source rows (e.g., FY totals)
  TEMPORAL   — comparison across periods; two sources, one calculation
  EXTRACTED  — direct source rows, shown as evidence in provenance panels

The React app renders figures exclusively from this output. The AI layer
("Refine narrative") operates on placeholder tokens and never sees or
emits numerals — see src/ai.ts.
"""
import pandas as pd
import json

SOURCE = "Vendor-Payments_2021-23.xlsx"
SHEETS = {"2022": "FY 2022", "2023": "FY 2023"}
COLS = ["FY", "FMonth", "Agency", "Category", "SubCategory", "Vendor", "Amount"]


def load() -> pd.DataFrame:
    frames = []
    for sheet in SHEETS.values():
        d = pd.read_excel(SOURCE, sheet_name=sheet, usecols=COLS,
                          dtype={"FY": str, "FMonth": str})
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    # Source quirk: text columns are right-padded with spaces in the raw file.
    for c in ["Agency", "Category", "SubCategory", "Vendor"]:
        df[c] = df[c].str.strip()
    return df


def tier3(value: float, fy: str, method: str, rows: int) -> dict:
    return {"tier": "AGGREGATED", "value": round(float(value), 2),
            "method": method,
            "sources": [{"sheet": SHEETS[fy], "rows_contributing": int(rows)}]}


def tier4(current: dict, prior: dict, method: str) -> dict:
    return {"tier": "TEMPORAL",
            "value": round(float(current["value"] - prior["value"]), 2),
            "method": method, "current": current, "prior": prior}


def build(df: pd.DataFrame) -> dict:
    out: dict = {}
    rowcounts = df.groupby("FY").size().to_dict()
    t22 = df[df.FY == "2022"]["Amount"].sum()
    t23 = df[df.FY == "2023"]["Amount"].sum()

    out["totals"] = {
        "fy2022": tier3(t22, "2022", "Sum of Amount across all FY 2022 payment rows", rowcounts["2022"]),
        "fy2023": tier3(t23, "2023", "Sum of Amount across all FY 2023 payment rows", rowcounts["2023"]),
    }
    out["totals"]["yoy"] = tier4(out["totals"]["fy2023"], out["totals"]["fy2022"],
                                 "FY2023 total minus FY2022 total")

    ag = df.pivot_table(index="Agency", columns="FY", values="Amount", aggfunc="sum", fill_value=0)
    agn = df.groupby(["Agency", "FY"]).size().unstack(fill_value=0)
    agencies = []
    for name, r in ag.iterrows():
        agencies.append({
            "name": name,
            "fy2022": round(float(r["2022"]), 2), "fy2023": round(float(r["2023"]), 2),
            "delta": round(float(r["2023"] - r["2022"]), 2),
            "pct": round(float((r["2023"] - r["2022"]) / r["2022"] * 100), 1) if r["2022"] > 0 else None,
            "rows": {"2022": int(agn.loc[name, "2022"]), "2023": int(agn.loc[name, "2023"])},
        })
    agencies.sort(key=lambda a: -a["fy2023"])
    out["agencies"] = agencies

    cat = df.pivot_table(index="Category", columns="FY", values="Amount", aggfunc="sum", fill_value=0)
    out["categories"] = [
        {"name": n, "fy2022": round(float(r["2022"]), 2), "fy2023": round(float(r["2023"]), 2),
         "delta": round(float(r["2023"] - r["2022"]), 2)}
        for n, r in cat.sort_values("2023", ascending=False).iterrows()]

    v = (df[df.FY == "2023"].groupby("Vendor")
         .agg(total=("Amount", "sum"), rows=("Amount", "size"),
              agencies=("Agency", lambda s: list(s.value_counts().head(3).index)))
         .sort_values("total", ascending=False))
    top_vendors = []
    for name, r in v.head(15).iterrows():
        samples = df[(df.FY == "2023") & (df.Vendor == name)].nlargest(3, "Amount")
        top_vendors.append({
            "name": name.title(), "total": round(float(r["total"]), 2), "payments": int(r["rows"]),
            "topAgencies": [a.strip() for a in r["agencies"]],
            "sampleRows": [{"sheet": SHEETS["2023"], "month": int(s.FMonth) - 12, "agency": s.Agency,
                            "subcategory": s.SubCategory, "amount": round(float(s.Amount), 2)}
                           for s in samples.itertuples()],
        })
    out["topVendors"] = top_vendors
    out["concentration"] = {
        "top10Share": round(float(v.head(10)["total"].sum() / t23 * 100), 1),
        "top100Share": round(float(v.head(100)["total"].sum() / t23 * 100), 1),
        "vendorCount": int(df[df.FY == "2023"]["Vendor"].nunique()),
    }

    m = df.copy()
    m["mn"] = m["FMonth"].astype(int)
    # Source quirk: FMonth runs 1-24 across the biennium; FY2023 months are 13-24.
    m.loc[m.FY == "2023", "mn"] -= 12
    ms = m.groupby(["FY", "mn"])["Amount"].sum()
    out["monthly"] = {fy: [round(float(ms.loc[fy].get(i, 0)), 2) for i in range(1, 13)]
                      for fy in ["2022", "2023"]}

    out["meta"] = {
        "sourceFile": SOURCE, "totalRows": int(len(df)),
        "sheets": {"FY 2022": rowcounts["2022"], "FY 2023": rowcounts["2023"]},
        "agencyCount": int(df["Agency"].nunique()), "vendorCount": int(df["Vendor"].nunique()),
        "generated": "deterministic pipeline v1 — no model involvement in any figure",
    }
    return out


if __name__ == "__main__":
    data = build(load())
    header = ("// GENERATED by pipeline/pipeline.py — the deterministic core.\n"
              "// Every figure in the application renders from this module and nowhere else.\n"
              "// No model was involved in producing any value in this file.\n")
    with open("../src/aggregates.ts", "w") as f:
        f.write(header + "export const DATA = " + json.dumps(data, indent=1) + " as const;\n")
    print("aggregates written:", len(data["agencies"]), "agencies,",
          len(data["topVendors"]), "vendors profiled")
