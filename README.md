# WA Fiscal Briefing

A proof-of-concept that inverts the usual answer to "make data useful for non-technical users."
Instead of giving the user a place to ask questions, the data introduces itself — and then
every figure defends itself.

**Run it — three doors, in descending friction:**
1. Live demo: https://wa-fiscal-briefing.netlify.app/
2. Open `dist/index.html` — the production build is a single self-contained file; no server, no install.
3. `npm install && npm run dev` for the typed source (data is inlined; no database, no env vars).

The optional AI feature asks for an API key at runtime — see *Bounded AI* below.

---

## The user, and the thesis

The brief asks for a tool for someone who has never written a query: a councilmember, a journalist, a curious resident. The defining fact about that user is not that they can't write SQL. It's that **they don't know what to ask.** A blank query box, natural-language or otherwise, is the most intimidating interface in software when you don't know what's in
the data or what normal looks like.

So this POC rejects the query-first pattern. It opens on **The Briefing**: four paragraphs of plain prose in which the analysis has already been done: the year's headline, where the money concentrates, what fell, and one anomaly worth a look. Orientation before interrogation. Exploration is *earned through interaction*: every figure in the prose is selectable, opening its full provenance without leaving the page.

The second design conviction: **for a civic user, trust is the product.** A number a journalist can't trace is a number they can't print. Every figure on screen carries a provenance tier:

- `AGGREGATED`: composed from source rows ("sum of 484,824 FY 2023 payment rows")
- `TEMPORAL`: a comparison across periods; two sources, one calculation, both shown
- `EXTRACTED`: actual source rows, displayed as evidence

Each renders in a consistent two-line format: line one, what the number is and how it was calculated; line two, the sources. One mental model, applied universally: *select any number, see its work.*

## Architecture: deterministic core, bounded AI

```
Vendor-Payments_2021-23.xlsx  (935,853 rows)
        │
        ▼
pipeline/pipeline.py      ← the ONLY place numbers are computed (reproducible, no model)
        │
        ▼
src/aggregates.ts         ← every aggregate + lineage metadata (25 KB)
        │
        ▼
src/App.tsx               ← renders figures exclusively from the data module
        │
        ▼  (optional)
src/ai.ts                 ← AI rewrites PROSE around placeholder tokens; never sees a numeral
```

The AI feature ("Refine narrative": rewrite the briefing for a councilmember, a journalist, or a resident) is bounded **architecturally, not by instruction**:

1. The narrative the model receives contains tokens, like `{{fig:totals.yoy}}`, and never numerals.
2. The model returns prose with tokens. A deterministic validator confirms every token survived exactly once and that no new numerals were introduced. Any violation → the rewrite is rejected and the verified narrative stays on screen, with the rejection visible.
3. Figures are re-rendered from the data module at display time. **There is no code path by which model output becomes a number on screen.**

When the model call fails, the interface says what happened and what to do, and states that the deterministic narrative remains. The system never presents confidence it hasn't earned.

### Three roles for AI in an analytics product

This build surfaced a complete taxonomy, and each role gets exactly the validation physics its epistemics permit:

1. **Narration.** Prose around verified figures. Validated deterministically: the model receives tokens, never numerals, and the token round-trip is checked after every call. Built here.
2. **Verdict narration.** Statuses, comparisons, rankings, benchmark positions. Made hallucination-proof by pre-computing every verdict before the model sees the payload: each number travels as a self-interpreting object carrying unit, label, source, status, delta, and benchmark, and the composition layer cannot override those verdicts. This tier is not speculative. It runs in production in the platform this design philosophy comes from, across thirteen query domains.
3. **Hypothesis.** Causal readings, like the analyst note above. Irreducibly unverifiable by construction: causality is not present in the data, so no architecture can validate it. The only honest treatment is the one applied here: the claim is labeled INTERPRETED, opens its own provenance (model authorship disclosed, the figures it reasons from cited, and a falsification test stated), and is never presented as computation.

The production roadmap for live interpretation follows directly: verdict narration ships behind the self-interpreting-object architecture; hypothesis generation ships only with the INTERPRETED labeling contract, falsification criteria required, and never inline with computed claims.

## AI governance (challenge requirement)

Every model input is logged: full prompt, response, timestamps, and validation verdict, in an in-memory ring buffer surfaced in the interface itself as `AI LOG`, top right. The audit trail is a *user-facing feature*, not a console artifact: an enterprise buyer's compliance reviewer can read exactly what left the building. Production design: these records POST to an
append-only audit store server-side before the model call resolves (see below).

API keys are entered at runtime, held in memory only, never persisted, never logged. Direct browser→Anthropic calls are a development-only pattern (the `anthropic-dangerous-direct-browser-access` header is named that for a reason); in production all model traffic moves behind a server-side proxy and the key never reaches a client.

## Explicit trade-offs

1. **Pre-aggregation over live query.** 935,853 rows cannot ship to a browser, and a query backend is beyond a POC. The pipeline compresses the dataset to 25 KB of aggregates *with lineage metadata*, trading ad-hoc flexibility for instant load and total determinism, while the lineage preserves traceability across the trade. The cost is real: a user cannot ask a question the pipeline didn't anticipate. Production closes that gap with a query layer that reads the same provenance taxonomy.
2. **A curated briefing over open exploration.** Breadth was traded for orientation, on the thesis that the non-technical user's bottleneck is not query syntax but not knowing what to ask. The movers chart and vendor table provide the second level of depth; the drawer provides the third. Depth is encountered only when reached for.
3. **No chart library.** The movers visualization is hand-rolled (CSS grid + proportional bars, max bar capped at 85% of track). For two simple visualizations, a charting dependency buys risk and bundle weight, not capability. The cost: anything beyond bars and tables would justify the dependency.
4. **One component file.** The app is a single `App.tsx` so a reviewer can read the whole product in one pass. At production scale this becomes a component library enforcing the design system in code (zero-radius containers, semantic typography, provenance tags as primitives; the components simply don't offer violations).

## POC vs production: what would have to change

- **The pipeline becomes a service.** Today: a script run by hand. Production: scheduled ingestion with schema validation at the boundary (the source file has quirks, noted below, and a schema change should fail loudly, not silently mis-aggregate), versioned outputs, and checksums so any on-screen figure can be matched to a pipeline run.
- **Provenance gets row-level addresses.** Sample rows are illustrative here; production stores source row identifiers per aggregate so "show me the rows" is exhaustive, not representative.
- **Model traffic moves server-side.** Key custody, rate limiting, the append-only audit log, and prompt versioning all live behind a proxy.
- **The figure registry becomes data-driven.** Token IDs are hand-authored here; production generates the registry from the aggregation schema so narrative authors can only reference figures that exist.
- **Accessibility hardening.** Focus management when the drawer opens, full screen-reader pass on the provenance tables, and a no-JS fallback rendering the verified narrative as static text.
- **Testing.** The validator and the pipeline are the two components where a bug is a trust failure. The validator ships with a starter suite (`npm test`, in `src/ai.test.ts`, including the live rejection from NOTES 08 as a regression case); production extends both to exhaustive property-based tests.

## Generalization: what would it take to point this at another dataset?

Deliberately specific by scope, portable by architecture. The dataset-specific surface is three things: the pipeline's aggregation choices (what is worth computing for *this* data), the narrative text, and the figure registry binding tokens to aggregates. Everything load-bearing is invariant: the provenance taxonomy and two-line format, the token-validation boundary around the model, the briefing-first pattern, and the renderer. A second dataset costs a new pipeline config and a new editorial pass, not a new system. Building the generic version inside this exercise was considered and rejected: the brief asks for one opinionated answer for one real dataset, and a one-hour generic data tool demonstrates less product judgment than a specific one.

## Design

The visual system follows a documented design philosophy ("Esoteric Industrialism," built and codified during the construction of a production financial-intelligence platform). The philosophy ports; the register translates:

- **Typography is semantic.** Serif (IBM Plex Serif) is the narrative voice; the briefing reads like the front page, which is precisely the register a civic reader trusts. Mono (IBM Plex Mono) is the machine voice: every figure, every action. Small tracked sans is the structural voice: labels and metadata. The typeface tells the user what kind of information they're looking at before they read it.
- **Color is information, never decoration.** Civic blue for the interactive (figures, actions); muted green/red strictly for direction of change; everything else is ink on paper.
- **Every line is load-bearing.** Zero border-radius, hairline scribe dividers, an accounting-style summation rule above the totals row, status conveyed in type rather than ornament. Numbers appear instantly, with no count-up animations. Data is, or it isn't.
- **Compression, not overlay.** The provenance drawer pushes content aside rather than covering it; the reader keeps their place while auditing a figure.
- **Two views, no scrolling pages.** BRIEFING answers "what do I need to know"; THE DATA answers "where do I look deeper." Each composes within the viewport, and the capsule toggle makes the switch one action. A scroll is a sequence; these are two different questions, so they are two different rooms.
- The register decision itself: the parent philosophy was built for operators reading dense terminals at 6 AM: dark, dense, fluency-first. This user is a civic reader; the same principles render here as paper, ink, and editorial calm. **Design follows the user; philosophy survives the translation.**

## Data notes (things the file actually does)

- Text columns arrive right-padded with whitespace; the pipeline strips them before grouping (un-stripped, vendor and agency groupings silently fragment).
- `FMonth` runs 1–24 across the biennium; FY 2023 months are 13–24 and are normalized.
- The source is already aggregated monthly per vendor; Molina Healthcare's $5.25B arrives as just 12 rows. Lineage metadata therefore reports *rows contributing* per aggregate rather than implying transaction-level counts.

## AI collaboration

The build process, including every moment the AI was redirected and why, is documented in `NOTES.md`, and the mandatory video covers the most consequential redirection in detail.