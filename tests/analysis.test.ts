import { describe, expect, it } from "vitest";
import { analyzeResponse, shouldExit } from "../src/ralph.js";

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
});
