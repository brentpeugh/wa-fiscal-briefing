/**
 * Tests for the deterministic validation boundary (src/ai.ts → validate).
 *
 * This is the one component where a bug is a trust failure: if validate()
 * wrongly accepts, a model-altered figure could reach the screen; if it
 * wrongly rejects, the AI feature silently dies (which happened — see
 * NOTES.md entry 08, reproduced as a regression case below).
 */
import { describe, it, expect } from "vitest";
import { validate } from "./ai";

const SRC =
  "State paid {{fig:totals.fy23}} in fiscal year 2023, an increase of " +
  "{{fig:totals.yoy}}, or {{fig:totals.pct}}, over the prior year.";

describe("validate — token integrity", () => {
  it("accepts a faithful rewrite with all tokens intact", () => {
    const out =
      "In fiscal year 2023 the state paid {{fig:totals.fy23}}, an increase " +
      "of {{fig:totals.yoy}} ({{fig:totals.pct}}) over the prior year.";
    expect(validate(SRC, out)).toBe(true);
  });

  it("is order-independent: prose may legitimately reorder figures", () => {
    const out =
      "Growth of {{fig:totals.pct}}, or {{fig:totals.yoy}}, brought fiscal " +
      "year 2023 spending to {{fig:totals.fy23}}.";
    expect(validate(SRC, out)).toBe(true);
  });

  it("rejects when a token is dropped", () => {
    const out = "The state paid {{fig:totals.fy23}} in fiscal year 2023.";
    expect(validate(SRC, out)).toBe(false);
  });

  it("rejects when a token is duplicated", () => {
    const out =
      "{{fig:totals.fy23}} and again {{fig:totals.fy23}}, up " +
      "{{fig:totals.yoy}} ({{fig:totals.pct}}) in fiscal year 2023.";
    expect(validate(SRC, out)).toBe(false);
  });

  it("rejects when a token id is mutated", () => {
    const out =
      "State paid {{fig:totals.fy24}} in fiscal year 2023, up " +
      "{{fig:totals.yoy}} ({{fig:totals.pct}}).";
    expect(validate(SRC, out)).toBe(false);
  });

  it("rejects an empty rewrite", () => {
    expect(validate(SRC, "")).toBe(false);
  });
});

describe("validate — numeral boundary", () => {
  it("REGRESSION (NOTES 08): allows numerals the source itself contains", () => {
    // v1 of the guard rejected faithful rewrites echoing "fiscal year 2023".
    const out =
      "Fiscal year 2023 spending reached {{fig:totals.fy23}}, up " +
      "{{fig:totals.yoy}}, or {{fig:totals.pct}}.";
    expect(validate(SRC, out)).toBe(true);
  });

  it("allows reusing a source numeral more than once", () => {
    const out =
      "In 2023 — fiscal year 2023 — the state paid {{fig:totals.fy23}}, up " +
      "{{fig:totals.yoy}} ({{fig:totals.pct}}).";
    expect(validate(SRC, out)).toBe(true);
  });

  it("rejects numerals the model introduces on its own", () => {
    const out =
      "State paid {{fig:totals.fy23}} in fiscal year 2023, up " +
      "{{fig:totals.yoy}}, or {{fig:totals.pct}} — about 14 percent.";
    expect(validate(SRC, out)).toBe(false);
  });

  it("rejects a fabricated year", () => {
    const out =
      "By 2024 projections, state paid {{fig:totals.fy23}} in fiscal year " +
      "2023, up {{fig:totals.yoy}} ({{fig:totals.pct}}).";
    expect(validate(SRC, out)).toBe(false);
  });
});
