import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { heartbeatStatus, normalizeConfig, resolvePaths } from "../src/ralph.js";

describe("heartbeat status", () => {
  it("returns empty status when missing", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-"));
    const config = normalizeConfig({ projectRoot });
    const status = await heartbeatStatus(config);
    expect(status.sessionId).toBe("");
    expect(status.lastRun).toBe(null);
  });

  it("reads heartbeat file when present", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-"));
    const config = normalizeConfig({ projectRoot });
    const paths = resolvePaths(config);
    const payload = {
      sessionId: "abc123",
      lastRun: "2025-01-01T00:00:00.000Z",
      lastLoop: 2,
      lastAnalysis: {
        exitSignal: false,
        completionIndicators: 1,
        completionMatches: [],
        pendingIndicators: [],
      },
      heartbeatAt: "2025-01-01T00:00:05.000Z",
    };
    fs.writeFileSync(paths.heartbeatPath, JSON.stringify(payload), "utf-8");

    const status = await heartbeatStatus(config);
    expect(status.sessionId).toBe("abc123");
    expect(status.lastLoop).toBe(2);
  });
});
