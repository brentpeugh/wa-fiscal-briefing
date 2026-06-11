/**
 * WA FISCAL BRIEFING — App.tsx
 * Dual-view pattern: BRIEFING (synthesis — what you need to know) and
 * THE DATA (operational — where to look deeper). No scrolling pages;
 * each view composes within the viewport. Every figure is auditable
 * via the provenance drawer in either view. Rationale: README §Design.
 */
import { useEffect, useMemo, useState } from "react";
import { DATA } from "./aggregates";
import { refineNarrative, getAILog, AILogEntry } from "./ai";

/* ---------- formatting (display only; values come from the data module) ---------- */
const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`
    : a >= 1e6 ? `$${(a / 1e6).toFixed(0)}M`
    : `$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return v < 0 ? `−${s}` : s;
};
const exact = (v: number) => `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`;
const pctAbs = (v: number) => `${Math.abs(v).toFixed(0)}%`;

/* ---------- figure registry: token id -> display + provenance ---------- */
type Prov =
  | { tier: "AGGREGATED"; value: number; method: string; sources: readonly { sheet: string; rows_contributing: number }[] }
  | { tier: "TEMPORAL"; value: number; method: string; current: Prov; prior: Prov }
  | { tier: "EXTRACTED"; value: number; method: string; vendor: typeof DATA.topVendors[number] }
  | { tier: "INTERPRETED"; method: string; reasoningFrom: { label: string; display: string }[]; confirm: string };

const ag = (name: string) => DATA.agencies.find(a => a.name === name)!;
const vendorByFrag = (frag: string) => DATA.topVendors.find(v => v.name.includes(frag))!;
const grants = DATA.categories.find(c => c.name.startsWith("Grants"))!;
const health = ag("Health");
const schools = ag("Public Schools");
const geocko = vendorByFrag("Geocko");
const molina = vendorByFrag("Molina");

const agencyTemporal = (a: typeof health, label: string): Prov => ({
  tier: "TEMPORAL", value: a.delta, method: `${label}: FY2023 spend minus FY2022 spend`,
  current: { tier: "AGGREGATED", value: a.fy2023, method: `Sum of all FY 2023 payment rows where Agency = "${a.name}"`, sources: [{ sheet: "FY 2023", rows_contributing: a.rows["2023"] }] },
  prior: { tier: "AGGREGATED", value: a.fy2022, method: `Sum of all FY 2022 payment rows where Agency = "${a.name}"`, sources: [{ sheet: "FY 2022", rows_contributing: a.rows["2022"] }] },
});

const FIGS: Record<string, { display: string; prov: Prov }> = {
  "totals.fy23": { display: money(DATA.totals.fy2023.value), prov: DATA.totals.fy2023 as Prov },
  "totals.yoy": { display: money(DATA.totals.yoy.value), prov: DATA.totals.yoy as unknown as Prov },
  "totals.pct": {
    display: pctAbs(DATA.totals.yoy.value / DATA.totals.fy2022.value * 100),
    prov: { tier: "TEMPORAL", value: DATA.totals.yoy.value / DATA.totals.fy2022.value * 100, method: "Year-over-year change: (FY2023 − FY2022) ÷ FY2022", current: DATA.totals.fy2023 as Prov, prior: DATA.totals.fy2022 as Prov },
  },
  "cat.grants.delta": {
    display: money(grants.delta),
    prov: { tier: "TEMPORAL", value: grants.delta, method: `Category "${grants.name}": FY2023 minus FY2022`, current: { tier: "AGGREGATED", value: grants.fy2023, method: "Sum of FY 2023 rows in category", sources: [{ sheet: "FY 2023", rows_contributing: DATA.meta.sheets["FY 2023"] }] }, prior: { tier: "AGGREGATED", value: grants.fy2022, method: "Sum of FY 2022 rows in category", sources: [{ sheet: "FY 2022", rows_contributing: DATA.meta.sheets["FY 2022"] }] } },
  },
  "conc.top10": {
    display: `${DATA.concentration.top10Share} cents of every dollar`,
    prov: { tier: "AGGREGATED", value: DATA.concentration.top10Share, method: `Top-10 vendor totals ÷ all FY2023 spend. ${DATA.concentration.vendorCount.toLocaleString()} vendors were paid in FY2023; ten of them received ${DATA.concentration.top10Share}% of all dollars.`, sources: [{ sheet: "FY 2023", rows_contributing: DATA.meta.sheets["FY 2023"] }] },
  },
  "vendor.molina": { display: money(molina.total), prov: { tier: "EXTRACTED", value: molina.total, method: `Sum of ${molina.payments} monthly payment rows to ${molina.name} in FY 2023`, vendor: molina } },
  "agency.health.delta": { display: money(Math.abs(health.delta)), prov: agencyTemporal(health, "Department of Health") },
  "agency.health.pct": { display: pctAbs(health.pct ?? 0), prov: agencyTemporal(health, "Department of Health") },
  "agency.schools.pct": { display: pctAbs(schools.pct ?? 0), prov: agencyTemporal(schools, "Public Schools") },
  "vendor.geocko": { display: money(geocko.total), prov: { tier: "EXTRACTED", value: geocko.total, method: `Sum of ${geocko.payments} monthly payment rows to ${geocko.name} in FY 2023`, vendor: geocko } },
  "note.health": {
    display: "analyst note",
    prov: {
      tier: "INTERPRETED",
      method: "Model-generated hypothesis, authored during the build by AI reasoning over the computed aggregates. It is a reading, not a computation: causality is not present in payment data, so the system cannot verify this claim — only label it, cite what it reasons from, and state what would test it.",
      reasoningFrom: [
        { label: "Department of Health · FY2023 vs FY2022", display: money(health.delta) },
        { label: "Decline, year over year", display: pct(health.pct ?? 0) },
        { label: "Rank of decline among all agencies", display: "largest" },
      ],
      confirm: "Program-level Department of Health spending detail for FY2020–FY2023. If pandemic-era line items account for the decline, the reading holds; if the decline is spread across permanent programs, it fails.",
    },
  },
};

/* ---------- the deterministic narrative (tokens, never numerals) ----------
   Voice: institutional. Direct sentences. Claims limited to what the
   pipeline computed; interpretation is confined to the analyst note. */
const NARRATIVE = `Washington State paid vendors {{fig:totals.fy23}} in fiscal year 2023, an increase of {{fig:totals.yoy}}, or {{fig:totals.pct}}, over the prior year. The growth is attributable almost entirely to a single category. Grants, benefits, and client services rose {{fig:cat.grants.delta}}.

Spending is concentrated. The ten largest vendors collected {{fig:conc.top10}} the state paid out. The largest, Molina Healthcare of Washington, received {{fig:vendor.molina}}, which exceeds the total annual spend of every agency except the two largest. Five of the six largest vendors are managed care plans. The state's largest financial relationships are with healthcare intermediaries.

Two declines stand out against the growth. Department of Health spending fell {{fig:agency.health.delta}}, a {{fig:agency.health.pct}} reduction and the largest in the budget. Public Schools payments fell {{fig:agency.schools.pct}}.

One vendor warrants attention. Geocko Inc. is the seventh largest vendor at {{fig:vendor.geocko}}. The names around it on the list are health plans, a state pass-through, a purchasing card program, and a construction firm. Geocko is the exception. Every figure in this briefing is computed from the source ledger and traceable to it. Select any number to see its work.`;

const INTERPRETATION = `The Health decline is consistent with pandemic-era programs concluding. That reading is an interpretation rather than a computation, and is therefore held in this note rather than in the briefing.`;

/* ---------- UI ---------- */
type View = "briefing" | "data";
type Drawer = { kind: "prov"; figId: string } | { kind: "ailog" } | null;

export default function App() {
  const [view, setView] = useState<View>("briefing");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [narrative, setNarrative] = useState(NARRATIVE);
  const [audience, setAudience] = useState("a city councilmember");
  const [apiKey, setApiKey] = useState("");
  const [askKey, setAskKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [refined, setRefined] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refine = async () => {
    if (!apiKey) { setAskKey(true); return; }
    setBusy(true); setAiNote(null);
    const r = await refineNarrative(apiKey, NARRATIVE, audience);
    setBusy(false);
    if (r.ok) { setNarrative(r.text); setRefined(true); }
    else setAiNote(r.reason);
  };

  const openFig = (id: string) => setDrawer({ kind: "prov", figId: id });

  return (
    <div className="frame">
      <style>{CSS}</style>

      <header className="hd">
        <span className="lbl">WASHINGTON STATE · VENDOR PAYMENTS · FY2022–FY2023</span>
        <nav className="tabs" aria-label="View">
          <button className={"tab" + (view === "briefing" ? " on" : "")} onClick={() => setView("briefing")}>BRIEFING</button>
          <button className={"tab" + (view === "data" ? " on" : "")} onClick={() => setView("data")}>DATA</button>
        </nav>
        <button className="act" onClick={() => setDrawer(d => d?.kind === "ailog" ? null : { kind: "ailog" })}>AI LOG</button>
      </header>

      <div className="body">
        <main className="main">
          {view === "briefing" && (
            <section className="brief">
              <h1 className="greet">Briefing</h1>
              <div className="lbl sub">{DATA.meta.totalRows.toLocaleString()} PAYMENTS · {DATA.meta.agencyCount} AGENCIES · {DATA.meta.vendorCount.toLocaleString()} VENDORS · SOURCE: {DATA.meta.sourceFile}</div>

              {narrative.split(/\n\n+/).map((para, i) => (
                <p className="nar" key={i}>{renderTokens(para, openFig)}</p>
              ))}

              <p className="note"><span className="lbl">ANALYST NOTE · INTERPRETED</span> · <button className="notelink" onClick={() => openFig("note.health")}><em>{INTERPRETATION}</em></button></p>

              <div className="refine">
                <span className="lbl">REWRITE FOR</span>
                <select className="sel" value={audience} onChange={e => setAudience(e.target.value)}>
                  <option>a city councilmember</option>
                  <option>a local journalist</option>
                  <option>a resident with no budget background</option>
                </select>
                <button className="act" onClick={refine} disabled={busy}>{busy ? "WORKING…" : "REFINE NARRATIVE"}</button>
                {refined && <button className="act" onClick={() => { setNarrative(NARRATIVE); setRefined(false); }}>RESTORE VERIFIED</button>}
                <span className="grow" />
                <button className="act enter" onClick={() => setView("data")}>EXPLORE THE DATA →</button>
              </div>
              {askKey && (
                <div className="keyrow">
                  <span className="lbl">ANTHROPIC API KEY · HELD IN MEMORY ONLY, NEVER STORED</span>
                  <input className="keyin" type="password" value={apiKey} placeholder="sk-ant-…"
                    onChange={e => setApiKey(e.target.value)} />
                  <button className="act" onClick={() => { if (apiKey) { setAskKey(false); refine(); } }}>USE</button>
                </div>
              )}
              {aiNote && <p className="ainote">{aiNote}</p>}
              {refined && <p className="lbl ok">MODEL REWRITE ACCEPTED · ALL FIGURE TOKENS VALIDATED · FIGURES RENDER FROM THE DETERMINISTIC CORE</p>}
            </section>
          )}

          {view === "data" && <DataView openFig={openFig} />}
        </main>

        {drawer?.kind === "prov" && <ProvDrawer fig={FIGS[drawer.figId]} onClose={() => setDrawer(null)} />}
        {drawer?.kind === "ailog" && <AILogDrawer onClose={() => setDrawer(null)} />}
      </div>

      <footer className="ped">
        <div className="cell"><span className="lbl">PAYMENT ROWS</span><span className="mono num">{DATA.meta.totalRows.toLocaleString()}</span></div>
        <div className="cell"><span className="lbl">AGENCIES</span><span className="mono num">{DATA.meta.agencyCount}</span></div>
        <div className="cell"><span className="lbl">VENDORS</span><span className="mono num">{DATA.meta.vendorCount.toLocaleString()}</span></div>
        <div className="cell"><span className="lbl">FY2023 TOTAL</span><span className="mono num">{money(DATA.totals.fy2023.value)}</span></div>
        <div className="cell quiet"><span className="lbl">DETERMINISTIC CORE v1</span><span className="lbl">SELECT ANY FIGURE FOR ITS SOURCE</span></div>
      </footer>
    </div>
  );
}

/* ---------- THE DATA: one viewport, two columns, no page scroll ---------- */
function DataView({ openFig }: { openFig: (id: string) => void }) {
  const movers = useMemo(() => {
    const up = [...DATA.agencies].sort((a, b) => b.delta - a.delta).slice(0, 6);
    const dn = [...DATA.agencies].sort((a, b) => a.delta - b.delta).slice(0, 6).reverse();
    return [...up, ...dn];
  }, []);
  const maxAbs = Math.max(...movers.map(m => Math.abs(m.delta)));
  return (
    <div className="data">
      <section className="col">
        <div className="lbl sect-t">THE MOVERS · CHANGE IN AGENCY SPEND, FY2022 → FY2023</div>
        <div className="movers">
          {movers.map((m, i) => {
            const w = Math.abs(m.delta) / maxAbs * 85; /* 85% rule */
            return (
              <button key={m.name} className="mrow" onClick={() => openFig(registerAgency(m))}>
                <span className="mono dim midx">{String(i + 1).padStart(2, "0")}</span>
                <span className="mname">{m.name}</span>
                <span className="mtrack">
                  <span className={"mbar " + (m.delta >= 0 ? "up" : "dn")} style={{ width: `${w}%` }} />
                </span>
                <span className={"mval mono " + (m.delta >= 0 ? "up-t" : "dn-t")}>{money(m.delta)}</span>
                <span className="mpct mono">{m.pct === null ? "—" : pct(m.pct)}</span>
              </button>
            );
          })}
        </div>
        <div className="lbl colfoot">TWELVE LARGEST MOVEMENTS OF {DATA.meta.agencyCount} AGENCIES · SELECT A ROW FOR ITS SOURCE</div>
      </section>

      <section className="col">
        <div className="lbl sect-t">WHERE THE DOLLARS LANDED · TEN LARGEST VENDORS, FY2023</div>
        <table className="vt">
          <tbody>
            {DATA.topVendors.slice(0, 10).map((v, i) => (
              <tr key={v.name}>
                <td className="mono dim">{String(i + 1).padStart(2, "0")}</td>
                <td><button className="vlink" onClick={() => openFig(registerVendor(v))}>{v.name}</button></td>
                <td className="lbl">{v.topAgencies[0]}</td>
                <td className="mono r">{exact(v.total)}</td>
              </tr>
            ))}
            <tr className="sum">
              <td className="mono dim" />
              <td className="lbl" colSpan={2}>TEN VENDORS · SHARE OF ALL FY2023 SPEND</td>
              <td className="mono r">{DATA.concentration.top10Share}%</td>
            </tr>
          </tbody>
        </table>
        <div className="lbl colfoot">{DATA.concentration.vendorCount.toLocaleString()} VENDORS WERE PAID IN FY2023 · THE TOP ONE HUNDRED COLLECTED {DATA.concentration.top100Share}%</div>
      </section>
    </div>
  );
}

/* dynamic figure registration so every number in THE DATA is auditable */
function registerAgency(a: typeof DATA.agencies[number]): string {
  const id = `agency.${a.name}`;
  FIGS[id] = { display: money(a.delta), prov: agencyTemporal(a as typeof health, a.name) };
  return id;
}
function registerVendor(v: typeof DATA.topVendors[number]): string {
  const id = `vendor.${v.name}`;
  FIGS[id] = { display: exact(v.total), prov: { tier: "EXTRACTED", value: v.total, method: `Sum of ${v.payments} monthly payment rows to ${v.name} in FY 2023`, vendor: v } };
  return id;
}

function renderTokens(text: string, onFig: (id: string) => void) {
  const parts = text.split(/(\{\{fig:[a-zA-Z0-9_.[\]-]+\}\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\{\{fig:(.+)\}\}$/);
    if (!m) return <span key={i}>{p}</span>;
    const fig = FIGS[m[1]];
    if (!fig) return <span key={i} className="mono">∅</span>;
    return <button key={i} className="fig mono" onClick={() => onFig(m[1])}>{fig.display}</button>;
  });
}

function ProvLine({ p }: { p: Exclude<Prov, { tier: "INTERPRETED" }> }) {
  return (
    <div className="pv-block">
      <div className="pv-l1"><span className="mono big">{p.tier === "TEMPORAL" && Math.abs(p.value) < 1000 ? pct(p.value) : exact(p.value)}</span><span className="tag">{p.tier}</span></div>
      <div className="pv-method">{p.method}</div>
      {"sources" in p && (
        <div className="pv-src lbl">{p.sources.map(s => `${s.sheet} — ${s.rows_contributing.toLocaleString()} ROWS CONTRIBUTING`).join(" · ")} · {DATA.meta.sourceFile}</div>
      )}
    </div>
  );
}

function ProvDrawer({ fig, onClose }: { fig: { display: string; prov: Prov }; onClose: () => void }) {
  const p = fig.prov;
  if (p.tier === "INTERPRETED") {
    return (
      <aside className="drawer" role="dialog" aria-label="Provenance">
        <div className="dr-hd"><span className="lbl">SOURCE</span><button className="act" onClick={onClose}>CLOSE</button></div>
        <div className="pv-block">
          <div className="pv-l1"><span className="lbl">HYPOTHESIS</span><span className="tag">INTERPRETED</span></div>
          <div className="pv-method">{p.method}</div>
        </div>
        <div className="lbl pv-sub">REASONING FROM</div>
        <table className="pv-rows"><tbody>
          {p.reasoningFrom.map((r, i) => (
            <tr key={i}><td className="lbl">{r.label}</td><td className="mono r">{r.display}</td></tr>
          ))}
        </tbody></table>
        <div className="lbl pv-sub">WHAT WOULD CONFIRM OR FAIL IT</div>
        <div className="pv-method">{p.confirm}</div>
        <div className="pv-foot lbl">INTERPRETATIONS ARE NOT REPRODUCIBLE FROM THE SOURCE FILE. THEY ARE LABELED, CITED, AND FALSIFIABLE BY DESIGN — NEVER PRESENTED AS COMPUTATION.</div>
      </aside>
    );
  }
  return (
    <aside className="drawer" role="dialog" aria-label="Provenance">
      <div className="dr-hd"><span className="lbl">SOURCE</span><button className="act" onClick={onClose}>CLOSE</button></div>
      <ProvLine p={p} />
      {p.tier === "TEMPORAL" && (<>
        <div className="lbl pv-sub">CURRENT</div><ProvLine p={p.current as Exclude<Prov, { tier: "INTERPRETED" }>} />
        <div className="lbl pv-sub">PRIOR</div><ProvLine p={p.prior as Exclude<Prov, { tier: "INTERPRETED" }>} />
      </>)}
      {p.tier === "EXTRACTED" && (<>
        <div className="lbl pv-sub">PAID PRIMARILY BY</div>
        <div className="pv-method">{p.vendor.topAgencies.join(" · ")}</div>
        <div className="lbl pv-sub">LARGEST SOURCE ROWS · TIER 1 EVIDENCE</div>
        <table className="pv-rows"><tbody>
          {p.vendor.sampleRows.map((r, i) => (
            <tr key={i}>
              <td className="lbl">{r.sheet} · M{String(r.month).padStart(2, "0")}</td>
              <td className="lbl">{r.subcategory}</td>
              <td className="mono r">{exact(r.amount)}</td>
            </tr>
          ))}
        </tbody></table>
      </>)}
      <div className="pv-foot lbl">EVERY FIGURE IS REPRODUCIBLE FROM {DATA.meta.sourceFile} VIA pipeline/pipeline.py · {DATA.meta.generated.toUpperCase()}</div>
    </aside>
  );
}

function AILogDrawer({ onClose }: { onClose: () => void }) {
  const log = getAILog();
  return (
    <aside className="drawer" role="dialog" aria-label="AI audit log">
      <div className="dr-hd"><span className="lbl">AI AUDIT LOG · ALL MODEL INPUTS, LOGGED</span><button className="act" onClick={onClose}>CLOSE</button></div>
      {log.length === 0 && <div className="pv-method">No model calls yet. The briefing on screen was produced by the deterministic core alone. When [ REFINE NARRATIVE ] is used, the full prompt, response, and validation result appear here.</div>}
      {log.map((e: AILogEntry, i: number) => (
        <div className="pv-block" key={i}>
          <div className="pv-l1"><span className="mono">{e.ts}</span><span className="tag">{e.error ? "ERROR" : e.validated ? "VALIDATED" : "REJECTED"}</span></div>
          <div className="pv-method">{e.model} · {e.promptChars.toLocaleString()} input chars{e.error ? ` · ${e.error}` : ""}</div>
          <details><summary className="lbl">FULL PROMPT</summary><pre className="pv-pre">{e.prompt}</pre></details>
          {e.response && <details><summary className="lbl">RESPONSE</summary><pre className="pv-pre">{e.response}</pre></details>}
        </div>
      ))}
    </aside>
  );
}

/* ---------- styles: civic register, manifesto physics ---------- */
const CSS = `
:root{
  --paper:#FBFAF7; --ink:#1C1B18; --dim:#6F6B5E;
  --civic:#1F539F; --up:#2E7D4F; --dn:#B3403A;
  --scribe:rgba(28,27,24,.08); --scribe-soft:rgba(28,27,24,.05);
  --h:56px; --S:192px;
}
*{box-sizing:border-box;border-radius:0!important;margin:0;padding:0}
html,body,#root{height:100%}
body{background:var(--paper);color:var(--ink);font-family:'IBM Plex Serif',Georgia,serif}
button{background:none;border:none;color:inherit;cursor:pointer;font:inherit}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--civic);outline-offset:2px}
.mono{font-family:'IBM Plex Mono',monospace}
.lbl{font-family:system-ui,sans-serif;font-size:10px;letter-spacing:.14em;color:var(--dim)}
.r{text-align:right}.dim{color:var(--dim)}.grow{flex:1}
.frame{display:flex;flex-direction:column;height:100%}
.hd{height:var(--h);flex:none;display:flex;align-items:center;padding:0 24px;border-bottom:1px solid var(--scribe);gap:40px}
.tabs{display:flex;gap:28px;height:100%}
.tab{font-family:system-ui,sans-serif;font-size:11px;letter-spacing:.14em;color:var(--dim);height:100%;border-bottom:2px solid transparent}
.tab.on{color:var(--ink);border-bottom-color:var(--ink)}
.hd .act{margin-left:auto}
.act{font-family:system-ui,sans-serif;font-size:11px;letter-spacing:.12em;color:var(--civic)}
.act:disabled{color:var(--dim);cursor:default}
.body{flex:1;display:flex;min-height:0}
.main{flex:1;min-width:0;overflow:hidden;display:flex}

/* BRIEFING — the Industrial frame */
.brief{flex:1;padding:calc(var(--S)*.3) var(--S) 40px;overflow-y:auto;display:flex;flex-direction:column}
.greet{font-weight:500;font-size:30px;margin-bottom:8px}
.sub{display:block;margin-bottom:26px;padding-bottom:14px;border-bottom:1px solid var(--scribe)}
.nar{font-size:18px;line-height:1.7;margin-bottom:18px;text-align:justify;hyphens:auto;max-width:850px;margin-left:auto;margin-right:auto;width:100%}
.fig{font-size:16.5px;color:var(--civic);padding:0 2px;border-bottom:1px solid var(--civic)}
.fig:hover{background:rgba(31,83,159,.07)}
.note{font-size:14px;line-height:1.65;color:var(--dim);margin:8px 0 0}
.notelink{font:inherit;color:inherit;text-align:left;border-bottom:1px dotted var(--dim)}
.notelink:hover{color:var(--civic);border-bottom-color:var(--civic)}
.refine{display:flex;gap:20px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--scribe);padding-top:16px;margin-top:20px}
.sel{font-family:'IBM Plex Mono',monospace;font-size:12px;background:none;border:1px solid var(--scribe);padding:6px 8px;color:var(--ink)}
.enter{font-size:12px}
.keyrow{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.keyin{font-family:'IBM Plex Mono',monospace;font-size:12px;border:1px solid var(--scribe);padding:6px 8px;min-width:280px;background:none;color:var(--ink)}
.ainote{font-size:14px;color:var(--dn);margin-top:12px}
.ok{display:block;margin-top:12px;color:var(--up)}

/* DATA — Valence hierarchy */
.data{flex:1;display:flex;min-height:0}
.col{flex:1;min-width:0;padding:32px 40px;overflow-y:auto;display:flex;flex-direction:column}
.col+.col{border-left:1px solid var(--scribe)}
.sect-t{display:block;padding-bottom:12px;border-bottom:1px solid var(--scribe);margin-bottom:14px}
.colfoot{display:block;margin-top:auto;padding-top:18px;line-height:1.7}
.movers{display:flex;flex-direction:column}
.mrow{display:grid;grid-template-columns:28px minmax(140px,210px) 1fr 104px 56px;gap:14px;align-items:center;min-height:44px;padding:4px 0;border-bottom:1px solid var(--scribe-soft);text-align:left}
.mrow:hover{background:rgba(28,27,24,.025)}
.midx{font-size:12px}
.mname{font-family:system-ui,sans-serif;font-size:12.5px;letter-spacing:.06em;font-weight:500;text-transform:uppercase}
.mtrack{height:8px;position:relative;background:var(--scribe-soft)}
.mbar{position:absolute;top:0;bottom:0;left:0}
.mbar.up{background:var(--up)}.mbar.dn{background:var(--dn)}
.mval{font-size:13px}.mpct{font-size:11px;color:var(--dim)}
.up-t{color:var(--up)}.dn-t{color:var(--dn)}
.vt{width:100%;border-collapse:collapse}
.vt td{padding:0 12px 0 0;border-bottom:1px solid var(--scribe-soft);font-size:14px;vertical-align:middle;height:44px}
.vlink{font-family:system-ui,sans-serif;font-size:12.5px;letter-spacing:.06em;font-weight:500;text-transform:uppercase;border-bottom:1px solid transparent;text-align:left}
.vlink:hover{color:var(--civic);border-color:var(--civic)}
.sum td{border-top:1px solid var(--ink);border-bottom:none}

/* drawers */
.drawer{width:384px;flex:none;border-left:1px solid var(--scribe);padding:20px 22px;overflow-y:auto;background:var(--paper)}
.dr-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.pv-block{border:1px solid var(--scribe);padding:14px;margin-bottom:14px}
.pv-l1{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.big{font-size:20px}
.tag{font-family:system-ui,sans-serif;font-size:9px;letter-spacing:.14em;color:var(--dim)}
.pv-method{font-size:13.5px;line-height:1.55;margin-top:8px}
.pv-src{display:block;margin-top:10px;line-height:1.7}
.pv-sub{display:block;margin:16px 0 6px}
.pv-rows{width:100%;border-collapse:collapse}
.pv-rows td{padding:7px 6px 7px 0;border-bottom:1px solid var(--scribe-soft);font-size:11px}
.pv-foot{display:block;margin-top:18px;line-height:1.7}
.pv-pre{font-family:'IBM Plex Mono',monospace;font-size:10.5px;white-space:pre-wrap;margin-top:8px;color:var(--dim)}

/* pedestal: Valence stat band */
.ped{height:72px;flex:none;display:flex;align-items:stretch;border-top:1px solid var(--scribe)}
.cell{flex:1;display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 24px}
.cell+.cell{border-left:1px solid var(--scribe)}
.num{font-size:19px}
.cell.quiet{justify-content:center;gap:6px}

@media (max-width:1280px){.brief{padding:48px 96px}}
@media (max-width:980px){
  .brief{padding:28px 24px}
  .nar{font-size:18px}
  .fig{font-size:16.5px}
  .data{flex-direction:column;overflow-y:auto}
  .col{overflow:visible;padding:24px 20px}
  .col+.col{border-left:none;border-top:1px solid var(--scribe)}
  .drawer{position:fixed;right:0;top:var(--h);bottom:72px;box-shadow:-1px 0 0 var(--scribe);z-index:2}
  .ped .cell.quiet{display:none}
}
`;
