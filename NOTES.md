# Build Notes — AI Collaboration Log

Working log of decisions and redirections during the build. Maintained as the work happened,
per the challenge's process-documentation guidance. (Entries below are seeded from the
build session; extend with each iteration.)

---

**01 · Concept lock — rejecting the default.**
The obvious build under time pressure is a chat/query box over the CSV. Rejected before any
code: the target user doesn't know what to ask, so the product opens with answers (the
Briefing) and makes every figure auditable. The AI's role was deliberately demoted from
"answers questions about data" to "rewrites prose around verified figures."

**02 · Redirection — design register.**
The AI recommended abandoning my existing design language entirely for this audience ("don't
build your operator aesthetic — build something civic"). Redirected: the *philosophy* ports
(semantic typography, provenance-first, every line load-bearing, color as information); only
the *register* translates (paper and editorial calm instead of a dark operator terminal).
The aesthetic is a consequence of the philosophy, not the philosophy itself. This decision is
the subject of the video answer.

**03 · Decision — structure for the grader.**
Minimal Vite + React + TS with the aggregates inlined as a typed module, and the entire UI in
one readable file. Considered: a fuller project structure (more "production-shaped") and a
single HTML file (zero setup). Chose the middle: a reviewer should reach the product thinking
in under a minute, and `npm install && npm run dev` with no env vars is the lowest honest friction.

**04 · Decision — the AI boundary is architectural, not instructional.**
Early design had the model rewriting the narrative with the real numbers in the text and a
prompt instructing it not to change them. Replaced with the token architecture: the model
never sees or emits numerals; placeholders are validated deterministically after every call;
figures re-render from the data module. An instruction is a policy; the token round-trip is
physics. (This also made the governance log more meaningful — a reviewer can see in the
prompt itself that no figures were entrusted to the model.)

**05 · Decision — runtime key, never shipped.**
The challenge invites AI usage; the naive POC hardcodes a key. Key is entered at runtime,
held in memory, never persisted or logged; README documents the production posture
(server-side proxy). Logged here because it's the kind of corner a 45-minute POC usually cuts.

**06 · Data verification before UI.**
Pipeline output was checked against independent analysis of the file before any interface
work (totals, top movers, concentration, the FMonth 1–24 quirk, padded text columns).
Briefing claims were tightened to what the data supports — e.g., "Molina received more than
any agency spent, apart from the two largest" was verified against all 102 agencies, and the
interpretive claim about pandemic-era spending was moved out of the briefing into a labeled
ANALYST NOTE, because it is a reading, not a computation.

---

*(Continue logging below as iterations happen: what the AI produced, what didn't meet the
bar, what was done instead.)*

**07 · Redirection — no scrolling pages.**
The AI's first interface was a single scrolling page: briefing on top, charts and tables
below. Redirected to the dual-view pattern from my design practice: a scroll answers "what
is next down the page"; views answer different questions — BRIEFING (what do I need to
know) and THE DATA (where do I look deeper). Each view composes within the viewport;
the capsule toggle keeps the switch one action with no context lost.

**08 · Bug found in live testing — the guardrail was stricter than the source.**
First real [ REFINE NARRATIVE ] call was rejected by deterministic validation. Root cause:
the v1 numeral guard forbade nearly all digits in model output, but the source narrative
itself contains "fiscal year 2023" — a faithful rewrite echoing that phrase was rejected.
Two notes: the system failed exactly as designed (rewrite rejected, verified narrative held,
rejection visible in the AI LOG), and the fix was principled rather than a loosening — the
numeral allowlist is now derived from the source text, so the model may reuse numerals the
source contains and may never introduce new ones. Debugged the guardrail, not the model.

**09 · Voice pass on the deterministic narrative.**
Rewrote the briefing into an institutional register: direct declarative sentences, minimal
punctuation ornament, claims limited to what the pipeline computed. Categorical statements
("five of the six largest vendors are managed care plans") were verified against the data
before inclusion; interpretation remains confined to the labeled analyst note.

**10 · Structure revisited — serve both audiences.**
Earlier decision (minimal Vite) was tested against the grader's actual experience and
revised: added vite-plugin-singlefile so the production build is one self-contained HTML
that runs from a double-click. The repo now offers three doors in descending friction —
live URL, dist/index.html, npm run dev — instead of choosing between demo convenience
and a typed, reviewable codebase.

**11 · Redirection — conventions follow the audience, by product.**
The AI carried interface conventions from my operator platform (bracketed monospace
actions, capsule navigation) into a civic product. Redirected to the conventions from my
relationship-intelligence product, which already serves this lighter register: plain
tracked-caps sans for actions and tabs with underline-active state, numbered list rows
(index column, uppercase entity names, mono figures, serif descriptions), and a
label-over-number stat band as the persistent footer. Same design philosophy, third
register — operator terminal, sales workspace, civic briefing — each tuned to its reader.

**12 · Scope decision — specific by intent, portable by architecture.**
Considered making the tool dataset-agnostic. Rejected for this hour: the brief asks for one
opinionated answer for THIS data, and a generic 45-minute engine is a worse demonstration
of product judgment than a specific one. The dataset-specific surface is deliberately thin
(pipeline aggregation choices, narrative text, figure registry); the provenance taxonomy,
token-validation boundary, briefing-first pattern, and renderer are invariant. README
§Generalization records what a second dataset would cost.

**13 · Frame and measure.**
Widened the briefing into a fixed structural frame with the narrative set justified. The
measure at that width exceeds comfortable reading at 18px, so the narrative scales to 21px
with looser leading and auto hyphenation — the register of an institutional letter, which
matches the rewritten voice.

**14 · Micro-decisions, recorded because small lies compound.**
(a) Briefing body reduced to 18px so the view composes without scrolling on a 13-inch
viewport — but at the frame's full width, 18px stretches the measure past readable, so the
narrative column caps near 78 characters and centers within the frame while the structural
elements (stats rule, analyst note, refine row) continue spanning it. Every property is a
decision, not a side effect of another decision. (b) The vendor summation label was wrapping
to two lines; rather than shrink it or scatter the sentence across semantically-loaded
columns, the label spans the name and agency columns — a summation annotates the row, which
is why ledger totals span. Column position encodes meaning in that table; the fix respects it.

**15 · Final acceptance — the fold as hierarchy.**
On a 13-inch viewport the briefing and analyst note compose fully in view; the refine
controls sit below the fold. Accepted deliberately: the narrative is the content, the
controls are subordinate to it, and a reader who never scrolls has received everything
that matters. The fold became a hierarchy decision rather than a defect.

**16 · Tests where a bug is a trust failure.**
Added a test suite for the validation boundary — the one component where a wrong accept
puts a model-altered figure on screen and a wrong reject silently kills the feature. The
suite includes the live failure from entry 08 as a named regression case, plus the cases
that define the boundary: token drop, duplication, mutation, reorder (legitimate),
source-numeral reuse (legitimate), and introduced numerals (rejected). vitest as a dev
dependency only; the runtime dependency surface is unchanged.

**17 · Audited the artifact against its own doctrine — and found a violation.**
The analyst note is interpretation, correctly labeled as such — but its provenance was
undisclosed: it was authored by AI reasoning over the aggregates during the build, then
shipped as static text. Every figure could defend itself; the one sentence of judgment
could not. Fixed: the note is now a first-class provenance citizen — a new INTERPRETED
class whose drawer discloses model authorship, cites the figures it reasons from, and
states what would confirm or fail the reading. The deeper outcome is a complete taxonomy
of AI roles (narration / verdict narration / hypothesis), each validated to the limit its
epistemics permit — verdict narration is already proven in production elsewhere via
self-interpreting metric objects; hypothesis is unverifiable by construction and therefore
labeled and falsifiable instead. Live generation of interpretations stays on the
production roadmap for exactly that reason.
