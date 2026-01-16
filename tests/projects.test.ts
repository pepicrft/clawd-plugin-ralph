import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { getProjectConfig, normalizePluginConfig } from "../src/ralph.js";

describe("multi-project config", () => {
  it("falls back to a default project when none provided", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-"));
    const config = normalizePluginConfig({ projectRoot });
    expect(config.defaultProject).toBe("default");
    expect(config.projects.default.projectRoot).toBe(projectRoot);
  });

  it("selects the default project from projects", () => {
    const config = normalizePluginConfig({
      defaultProject: "micelio",
      projects: {
        micelio: { projectRoot: "/tmp/micelio" },
        plasma: { projectRoot: "/tmp/plasma" },
      },
    });

    const project = getProjectConfig(config);
    expect(project.projectRoot).toBe("/tmp/micelio");
  });

  it("throws on unknown project id", () => {
    const config = normalizePluginConfig({
      projects: {
        micelio: { projectRoot: "/tmp/micelio" },
      },
    });

    expect(() => getProjectConfig(config, "missing")).toThrowError(
      /Unknown project "missing"/i
    );
  });
});
