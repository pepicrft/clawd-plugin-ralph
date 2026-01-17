import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildRalphPrompt,
  ensureProjectStructure,
  normalizeConfig,
  resolvePaths,
} from "../src/ralph.js";

describe("config and scaffolding", () => {
  it("uses defaults relative to the base dir", () => {
    const baseDir = path.join(os.tmpdir(), "ralph-defaults");
    const config = normalizeConfig({}, baseDir);
    expect(config.projectRoot).toBe(baseDir);
    expect(config.promptFile).toBe("PROMPT.md");
    expect(config.planFile).toBe("@fix_plan.md");
  });

  it("enables runForever when requested or maxLoops <= 0", () => {
    const baseDir = path.join(os.tmpdir(), "ralph-forever");
    const configured = normalizeConfig({ runForever: true }, baseDir);
    expect(configured.runForever).toBe(true);

    const unlimited = normalizeConfig({ maxLoops: 0 }, baseDir);
    expect(unlimited.runForever).toBe(true);
  });

  it("creates the project structure", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-"));
    const config = normalizeConfig({ projectRoot });
    const paths = await ensureProjectStructure(config);

    expect(fs.existsSync(paths.promptPath)).toBe(true);
    expect(fs.existsSync(paths.planPath)).toBe(true);
    expect(fs.existsSync(paths.agentPath)).toBe(true);
    expect(fs.existsSync(paths.requirementsPath)).toBe(true);
  });

  it("builds a prompt that includes key files", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-"));
    const config = normalizeConfig({ projectRoot });
    const paths = await ensureProjectStructure(config);

    fs.writeFileSync(paths.promptPath, "Prompt content", "utf-8");
    fs.writeFileSync(paths.planPath, "Plan content", "utf-8");
    fs.writeFileSync(paths.agentPath, "Agent content", "utf-8");

    const prompt = await buildRalphPrompt(resolvePaths(config), "claude");
    expect(prompt).toContain("Prompt content");
    expect(prompt).toContain("Plan content");
    expect(prompt).toContain("Agent content");
  });
});
