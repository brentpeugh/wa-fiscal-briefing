/**
 * BOUNDED AI LAYER — ai.ts
 * =========================
 * The AI refines prose. It is architecturally incapable of altering a figure.
 *
 * How the boundary works:
 *   1. The briefing narrative is authored with placeholder tokens — {{fig:totals.yoy}} —
 *      never numerals. The model receives tokens, returns tokens.
 *   2. After the model responds, validate() confirms every token survived intact.
 *      If any token is missing, duplicated, or mutated, the response is REJECTED
 *      and the deterministic narrative renders instead.
 *   3. Figures are re-rendered from aggregates.ts at display time. There is no
 *      code path by which model output becomes a number on screen.
 *
 * Governance (challenge requirement: all model inputs logged):
 *   Every call is captured by logAICall() — full prompt, response, timestamps,
 *   validation result — held in an in-memory ring buffer surfaced in the UI
 *   via [ AI LOG ]. Production design: ship these records to an append-only
 *   audit store server-side; see README "POC vs production".
 *
 * Key handling: entered at runtime, held in memory only, never persisted,
 * never written to any log. Direct browser->Anthropic calls are a dev-only
 * pattern (anthropic-dangerous-direct-browser-access); production proxies
 * through a server so the key never reaches the client.
 */

export interface AILogEntry {
  ts: string;
  model: string;
  promptChars: number;
  prompt: string;       // full input, per governance requirement
  response: string | null;
  validated: boolean | null;
  error: string | null;
}

const LOG: AILogEntry[] = [];
export const getAILog = () => [...LOG];

function logAICall(entry: AILogEntry) {
  LOG.push(entry);
  // POC: console + in-memory, surfaced in the UI.
  // Production: POST to append-only audit store before the model call resolves.
  console.info("[AI-AUDIT]", entry.ts, entry.model, `${entry.promptChars} chars`,
    entry.error ? `ERROR: ${entry.error}` : `validated=${entry.validated}`);
}

const TOKEN_RE = /\{\{fig:[a-zA-Z0-9_.[\]-]+\}\}/g;

/**
 * Every token in the source must appear in the output exactly once, unaltered.
 * Numeral guard: the model may reuse numerals the SOURCE already contains
 * (e.g. "fiscal year 2023") but may never introduce a numeral of its own.
 * (v1 of this guard forbade nearly all digits and rejected valid rewrites that
 * echoed the source's own year references — the guardrail was stricter than
 * the text it guarded. The allowlist is now derived from the source itself.)
 */
export function validate(source: string, output: string): boolean {
  const want = (source.match(TOKEN_RE) ?? []).sort();
  const got = (output.match(TOKEN_RE) ?? []).sort();
  if (want.length !== got.length) return false;
  for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
  const digitRuns = (s: string) => s.replace(TOKEN_RE, "").match(/\d+/g) ?? [];
  const allowed = new Set(digitRuns(source));
  for (const run of digitRuns(output)) if (!allowed.has(run)) return false;
  return true;
}

const MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are the narrative layer of a deterministic fiscal-analysis system.
Rewrite the briefing text for the requested reader. Rules, absolute:
- Figures appear as tokens like {{fig:totals.yoy}}. Preserve every token exactly. Do not add, remove, reorder-away, or modify any token.
- Never write a numeral. Never compute. Never introduce a claim not present in the source text.
- Return only the rewritten narrative, no preamble.`;

export async function refineNarrative(
  apiKey: string,
  sourceNarrative: string,
  audience: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const prompt = `Reader: ${audience}.\n\nSource narrative:\n${sourceNarrative}`;
  const entry: AILogEntry = {
    ts: new Date().toISOString(), model: MODEL,
    promptChars: SYSTEM.length + prompt.length,
    prompt: `SYSTEM:\n${SYSTEM}\n\nUSER:\n${prompt}`,
    response: null, validated: null, error: null,
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      entry.error = `HTTP ${res.status}`;
      logAICall(entry);
      return { ok: false, reason: `The model call failed (HTTP ${res.status}). Check the API key and network, then retry. The deterministic narrative remains on screen.` };
    }
    const data = await res.json();
    const text: string = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("\n").trim();
    entry.response = text;
    entry.validated = validate(sourceNarrative, text);
    logAICall(entry);
    if (!entry.validated) {
      return { ok: false, reason: "The model's rewrite altered or dropped a figure token and was rejected by deterministic validation. The verified narrative remains on screen." };
    }
    return { ok: true, text };
  } catch (e) {
    entry.error = String(e);
    logAICall(entry);
    return { ok: false, reason: "The model call could not be made (network or CORS). The deterministic narrative remains on screen." };
  }
}
