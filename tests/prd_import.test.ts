import { describe, expect, it } from "vitest";
import { buildPrdConversionPrompt, parsePrdConversionOutput } from "../src/ralph.js";

describe("PRD import helpers", () => {
  it("builds a conversion prompt with source content", () => {
    const prompt = buildPrdConversionPrompt("spec.json", "{ \"name\": \"test\" }");
    expect(prompt).toContain("File: spec.json");
    expect(prompt).toContain("{ \"name\": \"test\" }");
  });

  it("summarizes JSON PRD fields for the prompt", () => {
    const json = JSON.stringify({
      project: "MyApp",
      branchName: "ralph/task-priority",
      description: "Task Priority System",
      userStories: [
        {
          id: "US-001",
          title: "Add priority field",
          description: "Store task priority",
          acceptanceCriteria: ["Add column", "Typecheck passes"],
          priority: 1,
        },
      ],
    });
    const prompt = buildPrdConversionPrompt("prd.json", json);
    expect(prompt).toContain("Parsed PRD Summary");
    expect(prompt).toContain("Project: MyApp");
    expect(prompt).toContain("Branch: ralph/task-priority");
    expect(prompt).toContain("Description: Task Priority System");
    expect(prompt).toContain("- P1 - US-001 - Add priority field");
    expect(prompt).toContain("Acceptance criteria:");
    expect(prompt).toContain("- Add column");
  });

  it("parses JSON output into files", () => {
    const output = JSON.stringify({
      files: {
        "PROMPT.md": "Prompt content",
        "@fix_plan.md": "Plan content",
        "specs/requirements.md": "Requirements content",
      },
    });
    const files = parsePrdConversionOutput(output, "json");
    expect(files).toEqual({
      "PROMPT.md": "Prompt content",
      "@fix_plan.md": "Plan content",
      "specs/requirements.md": "Requirements content",
    });
  });

  it("parses text output with file blocks", () => {
    const output = `FILE: PROMPT.md
\`\`\`markdown
Prompt content
\`\`\`

FILE: @fix_plan.md
\`\`\`markdown
Plan content
\`\`\`

FILE: specs/requirements.md
\`\`\`markdown
Requirements content
\`\`\`
`;
    const files = parsePrdConversionOutput(output, "text");
    expect(files).toEqual({
      "PROMPT.md": "Prompt content",
      "@fix_plan.md": "Plan content",
      "specs/requirements.md": "Requirements content",
    });
  });
});
