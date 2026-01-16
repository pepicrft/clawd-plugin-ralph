import { describe, expect, it } from "vitest";
import { analyzeResponse, buildCommitMessage, extractRalphSummary, shouldExit } from "../src/ralph.js";

describe("response analysis", () => {
  it("detects exit signal and completion indicators", () => {
    const response = `All tasks complete. Tests passing.

RALPH_STATUS:
EXIT_SIGNAL: true
SUMMARY: done
NEXT_STEPS: none
CHANGES: none
TESTS: not run`;

    const analysis = analyzeResponse(response);
    expect(analysis.exitSignal).toBe(true);
    expect(analysis.completionIndicators).toBeGreaterThanOrEqual(2);
    expect(shouldExit(analysis, 2)).toBe(true);
  });

  it("blocks exit without explicit exit signal", () => {
    const response = "All tasks complete. Tests passing.";
    const analysis = analyzeResponse(response);
    expect(analysis.exitSignal).toBe(false);
    expect(shouldExit(analysis, 2)).toBe(false);
  });

  it("extracts summary from the RALPH_STATUS block", () => {
    const response = `RALPH_STATUS:\nEXIT_SIGNAL: true\nSUMMARY: Shipping\nNEXT_STEPS: none`;
    expect(extractRalphSummary(response)).toBe("Shipping");
  });

  it("builds commit messages with a prefix", () => {
    expect(buildCommitMessage("[ralph]", "All done")).toBe("[ralph] All done");
    expect(buildCommitMessage("[ralph]", null)).toBe("[ralph] completion");
  });
});
