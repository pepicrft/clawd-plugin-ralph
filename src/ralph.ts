import { execFile } from "child_process";
import crypto from "crypto";
import fsp from "fs/promises";
import path from "path";
import { promisify } from "util";

export type RunnerConfigInput = {
  command?: string;
  args?: string[];
  outputFormat?: "json" | "text";
  allowedTools?: string;
  continueOnError?: boolean;
  retryLimit?: number;
  retryDelayMs?: number;
};

export type RalphProjectConfigInput = {
  projectRoot?: string;
  agent?: string;
  promptFile?: string;
  planFile?: string;
  agentFile?: string;
  specsDir?: string;
  logsDir?: string;
  sessionFile?: string;
  heartbeatFile?: string;
  heartbeatIntervalMs?: number;
  historyFile?: string;
  provider?: "claude" | "codex" | "custom";
  exitIndicatorThreshold?: number;
  maxLoops?: number;
  runForever?: boolean;
  sessionTimeoutHours?: number;
  runner?: RunnerConfigInput;
  git?: {
    enabled?: boolean;
    onExit?: boolean;
    push?: boolean;
    commitPrefix?: string;
    remote?: string;
  };
};

export type RalphConfigInput = RalphProjectConfigInput & {
  projects?: Record<string, RalphProjectConfigInput>;
  defaultProject?: string;
};

export type RunnerConfig = {
  command: string;
  args: string[];
  outputFormat: "json" | "text";
  allowedTools?: string;
  continueOnError: boolean;
  retryLimit: number;
  retryDelayMs: number;
};

export type RalphConfig = {
  projectRoot: string;
  agent: string;
  promptFile: string;
  planFile: string;
  agentFile: string;
  specsDir: string;
  logsDir: string;
  sessionFile: string;
  heartbeatFile: string;
  heartbeatIntervalMs: number;
  historyFile: string;
  provider: "claude" | "codex" | "custom";
  exitIndicatorThreshold: number;
  maxLoops: number;
  runForever: boolean;
  sessionTimeoutHours: number;
  runner: RunnerConfig;
  git: {
    enabled: boolean;
    onExit: boolean;
    push: boolean;
    commitPrefix: string;
    remote?: string;
  };
};

export type RalphPluginConfig = {
  defaultProject: string;
  projects: Record<string, RalphConfig>;
};

export type RalphPaths = {
  projectRoot: string;
  promptPath: string;
  planPath: string;
  agentPath: string;
  specsDir: string;
  requirementsPath: string;
  logsDir: string;
  logPath: string;
  sessionPath: string;
  heartbeatPath: string;
  historyPath: string;
};

export type RalphAnalysis = {
  exitSignal: boolean;
  completionIndicators: number;
  completionMatches: string[];
  pendingIndicators: string[];
};

export type RalphLoopResult = {
  loopsRun: number;
  lastResponse: string;
  lastAnalysis: RalphAnalysis;
};

type RalphSession = {
  sessionId: string;
  startedAt: string;
  lastRun?: string;
};

export type RalphHeartbeat = {
  sessionId: string;
  lastRun: string | null;
  lastLoop: number | null;
  lastAnalysis: RalphAnalysis | null;
  heartbeatAt: string | null;
};

export type PrdImportResult = {
  projectRoot: string;
  sourceFile: string;
  filesWritten: string[];
};

const execFileAsync = promisify(execFile);

const DEFAULT_PROMPT_FILE = "PROMPT.md";
const DEFAULT_AGENT = "claude";
const DEFAULT_PLAN_FILE = "@fix_plan.md";
const DEFAULT_AGENT_FILE = "@AGENT.md";
const DEFAULT_SPECS_DIR = "specs";
const DEFAULT_LOGS_DIR = "logs";
const DEFAULT_SESSION_FILE = ".ralph_session.json";
const DEFAULT_HEARTBEAT_FILE = ".ralph_heartbeat.json";
const DEFAULT_HEARTBEAT_INTERVAL = 30000;
const DEFAULT_HISTORY_FILE = ".ralph_session_history";
const DEFAULT_EXIT_THRESHOLD = 2;
const DEFAULT_MAX_LOOPS = 20;
const DEFAULT_RUN_FOREVER = false;
const DEFAULT_SESSION_TIMEOUT = 24;
const DEFAULT_COMMIT_PREFIX = "[ralph]";
const DEFAULT_RUNNER_RETRY_LIMIT = 0;
const DEFAULT_RUNNER_RETRY_DELAY_MS = 5000;
const PRD_REQUIRED_FILES = ["PROMPT.md", "@fix_plan.md", "specs/requirements.md"] as const;

const RALPH_STATUS_INSTRUCTIONS = `You must include a RALPH_STATUS block at the end of every response.

RALPH_STATUS:
EXIT_SIGNAL: true|false
SUMMARY: <one sentence>
NEXT_STEPS: <short bullet list or "none">
CHANGES: <short bullet list or "none">
TESTS: <short bullet list or "not run">`;

const PROMPT_TEMPLATE = `# Project Goal

Describe the outcome, constraints, and success criteria.

# Scope

- In scope:
- Out of scope:

# References

- Link to specs or design docs.

# Ralph Requirements

${RALPH_STATUS_INSTRUCTIONS}
`;

const PLAN_TEMPLATE = `# @fix_plan

- [ ] Define the first high-impact task.
- [ ] Add additional tasks in priority order.
`;

const AGENT_TEMPLATE = `# @AGENT

## Build

- Add build instructions here.

## Test

- Add test instructions here.
`;

const REQUIREMENTS_TEMPLATE = `# Requirements

Add detailed technical requirements here.
`;

const PRD_CONVERSION_TEMPLATE = `# PRD to Ralph Conversion Task

You are converting a Product Requirements Document into Ralph project files.

## Required Output

Return JSON with this shape:

{
  "files": {
    "PROMPT.md": "...",
    "@fix_plan.md": "...",
    "specs/requirements.md": "..."
  }
}

If JSON is not possible, return plain text using file blocks:

FILE: PROMPT.md
\`\`\`markdown
...
\`\`\`

FILE: @fix_plan.md
\`\`\`markdown
...
\`\`\`

FILE: specs/requirements.md
\`\`\`markdown
...
\`\`\`

## Content Guidance

- PROMPT.md: project goal, scope, references, and Ralph requirements.
- @fix_plan.md: prioritized tasks with clear next steps.
- specs/requirements.md: detailed technical requirements.

Use the provided PRD as the source of truth. Preserve constraints and success criteria.
`;

const COMPLETION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "all tasks complete", pattern: /all (tasks|items|work) (complete|completed)/i },
  { label: "tests passing", pattern: /tests? (all )?(pass|passing|green)/i },
  { label: "no changes needed", pattern: /no (further |additional )?changes (needed|required)/i },
  { label: "ready for review", pattern: /ready for (review|merge|release)/i },
  { label: "work complete", pattern: /(work|project|implementation) (is )?complete/i },
  { label: "nothing remaining", pattern: /nothing (left|remaining)/i },
  { label: "finished", pattern: /(finished|done|finalized)/i },
];

const PENDING_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "todo", pattern: /\btodo\b/i },
  { label: "remaining work", pattern: /remaining (work|tasks|items)/i },
  { label: "next steps", pattern: /next steps?/i },
  { label: "in progress", pattern: /in progress|working on/i },
];

function defaultRunner(provider: "claude" | "codex" | "custom"): RunnerConfig {
  if (provider === "codex") {
    return {
      command: "codex",
      args: ["--prompt", "{prompt}"],
      outputFormat: "text",
      continueOnError: false,
      retryLimit: DEFAULT_RUNNER_RETRY_LIMIT,
      retryDelayMs: DEFAULT_RUNNER_RETRY_DELAY_MS,
    };
  }
  return {
    command: "claude",
    args: ["-p", "{prompt}"],
    outputFormat: "text",
    continueOnError: false,
    retryLimit: DEFAULT_RUNNER_RETRY_LIMIT,
    retryDelayMs: DEFAULT_RUNNER_RETRY_DELAY_MS,
  };
}

export function normalizeConfig(
  input: RalphProjectConfigInput,
  baseDir: string = process.cwd()
): RalphConfig {
  const projectRoot = input.projectRoot ?? baseDir;
  const provider = input.provider ?? "claude";
  const runnerDefaults = defaultRunner(provider);
  const runnerInput = input.runner ?? {};
  const maxLoops = input.maxLoops ?? DEFAULT_MAX_LOOPS;
  const runForever = (input.runForever ?? DEFAULT_RUN_FOREVER) || maxLoops <= 0;
  const runner: RunnerConfig = {
    command: runnerInput.command ?? runnerDefaults.command,
    args: runnerInput.args ?? runnerDefaults.args,
    outputFormat: runnerInput.outputFormat ?? runnerDefaults.outputFormat,
    allowedTools: runnerInput.allowedTools,
    continueOnError: runnerInput.continueOnError ?? false,
    retryLimit: runnerInput.retryLimit ?? DEFAULT_RUNNER_RETRY_LIMIT,
    retryDelayMs: runnerInput.retryDelayMs ?? DEFAULT_RUNNER_RETRY_DELAY_MS,
  };
  const gitInput = input.git ?? {};

  return {
    projectRoot,
    agent: input.agent ?? DEFAULT_AGENT,
    promptFile: input.promptFile ?? DEFAULT_PROMPT_FILE,
    planFile: input.planFile ?? DEFAULT_PLAN_FILE,
    agentFile: input.agentFile ?? DEFAULT_AGENT_FILE,
    specsDir: input.specsDir ?? DEFAULT_SPECS_DIR,
    logsDir: input.logsDir ?? DEFAULT_LOGS_DIR,
    sessionFile: input.sessionFile ?? DEFAULT_SESSION_FILE,
    heartbeatFile: input.heartbeatFile ?? DEFAULT_HEARTBEAT_FILE,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL,
    historyFile: input.historyFile ?? DEFAULT_HISTORY_FILE,
    provider,
    exitIndicatorThreshold: input.exitIndicatorThreshold ?? DEFAULT_EXIT_THRESHOLD,
    maxLoops,
    runForever,
    sessionTimeoutHours: input.sessionTimeoutHours ?? DEFAULT_SESSION_TIMEOUT,
    runner,
    git: {
      enabled: gitInput.enabled ?? true,
      onExit: gitInput.onExit ?? true,
      push: gitInput.push ?? true,
      commitPrefix: gitInput.commitPrefix ?? DEFAULT_COMMIT_PREFIX,
      remote: gitInput.remote,
    },
  };
}

export function normalizePluginConfig(
  input: RalphConfigInput,
  baseDir: string = process.cwd()
): RalphPluginConfig {
  if (input.projects && Object.keys(input.projects).length > 0) {
    const projects: Record<string, RalphConfig> = {};
    for (const [projectId, projectInput] of Object.entries(input.projects)) {
      projects[projectId] = normalizeConfig(projectInput, projectInput.projectRoot ?? baseDir);
    }

    const projectIds = Object.keys(projects);
    const defaultProject =
      input.defaultProject && projects[input.defaultProject]
        ? input.defaultProject
        : projectIds[0];

    return {
      defaultProject,
      projects,
    };
  }

  return {
    defaultProject: "default",
    projects: {
      default: normalizeConfig(input, baseDir),
    },
  };
}

export function getProjectConfig(
  pluginConfig: RalphPluginConfig,
  projectId?: string
): RalphConfig {
  const resolvedId = projectId ?? pluginConfig.defaultProject;
  const project = pluginConfig.projects[resolvedId];
  if (!project) {
    const known = Object.keys(pluginConfig.projects).join(", ");
    throw new Error(`Unknown project \"${resolvedId}\". Available: ${known}`);
  }
  return project;
}

export function resolvePaths(config: RalphConfig): RalphPaths {
  const promptPath = path.resolve(config.projectRoot, config.promptFile);
  const planPath = path.resolve(config.projectRoot, config.planFile);
  const agentPath = path.resolve(config.projectRoot, config.agentFile);
  const specsDir = path.resolve(config.projectRoot, config.specsDir);
  const logsDir = path.resolve(config.projectRoot, config.logsDir);
  const requirementsPath = path.resolve(specsDir, "requirements.md");
  const logPath = path.resolve(logsDir, "ralph.log");
  const sessionPath = path.resolve(config.projectRoot, config.sessionFile);
  const heartbeatPath = path.resolve(config.projectRoot, config.heartbeatFile);
  const historyPath = path.resolve(config.projectRoot, config.historyFile);

  return {
    projectRoot: config.projectRoot,
    promptPath,
    planPath,
    agentPath,
    specsDir,
    requirementsPath,
    logsDir,
    logPath,
    sessionPath,
    heartbeatPath,
    historyPath,
  };
}

export async function ensureProjectStructure(
  config: RalphConfig,
  options: { overwrite?: boolean } = {}
): Promise<RalphPaths> {
  const paths = resolvePaths(config);
  await fsp.mkdir(paths.projectRoot, { recursive: true });
  await fsp.mkdir(paths.specsDir, { recursive: true });
  await fsp.mkdir(paths.logsDir, { recursive: true });

  await writeIfMissing(paths.promptPath, PROMPT_TEMPLATE, options.overwrite);
  await writeIfMissing(paths.planPath, PLAN_TEMPLATE, options.overwrite);
  await writeIfMissing(paths.agentPath, AGENT_TEMPLATE, options.overwrite);
  await writeIfMissing(paths.requirementsPath, REQUIREMENTS_TEMPLATE, options.overwrite);

  return paths;
}

export function buildPrdConversionPrompt(
  sourceName: string,
  sourceContent: string
): string {
  const summary = formatJsonPrdSummary(sourceContent);
  const sections = [
    PRD_CONVERSION_TEMPLATE,
    summary ? "## Parsed PRD Summary" : null,
    summary ?? null,
    "## Source PRD",
    `File: ${sourceName}`,
    "<PRD_SOURCE>",
    sourceContent,
    "</PRD_SOURCE>",
  ].filter((section): section is string => Boolean(section && section.trim()));

  return sections.join("\n\n");
}

async function writeIfMissing(
  filePath: string,
  contents: string,
  overwrite?: boolean
): Promise<void> {
  if (!overwrite && (await fileExists(filePath))) return;
  await fsp.writeFile(filePath, contents, "utf-8");
}

export async function buildRalphPrompt(paths: RalphPaths, agent: string): Promise<string> {
  const prompt = await readFileIfExists(paths.promptPath);
  const plan = await readFileIfExists(paths.planPath);
  const agentFile = await readFileIfExists(paths.agentPath);

  const sections = [
    "# Ralph Instructions",
    RALPH_STATUS_INSTRUCTIONS,
    `Agent: ${agent}`,
    "## PROMPT.md",
    prompt || "(missing PROMPT.md)",
    "## @fix_plan.md",
    plan || "(missing @fix_plan.md)",
    "## @AGENT.md",
    agentFile || "(missing @AGENT.md)",
  ];

  return sections.join("\n\n");
}

export function parsePrdConversionOutput(
  output: string,
  outputFormat: "json" | "text"
): Record<string, string> | null {
  const candidates: string[] = [];

  if (outputFormat === "json") {
    candidates.push(output);
  }

  const text = extractTextFromRunnerOutput(output, outputFormat);
  if (text && text !== output) {
    candidates.push(text);
  } else if (outputFormat === "text") {
    candidates.push(output);
  }

  for (const candidate of candidates) {
    const parsed = parsePrdFilesFromJson(candidate);
    if (parsed) return parsed;
  }

  for (const candidate of candidates) {
    const parsed = parsePrdFilesFromText(candidate);
    if (parsed) return parsed;
  }

  return null;
}

export async function importPrd(
  config: RalphConfig,
  options: {
    sourceFile: string;
    overwrite?: boolean;
    logger?: Console;
  }
): Promise<PrdImportResult> {
  const logger = options.logger ?? console;
  const sourcePath = path.resolve(process.cwd(), options.sourceFile);
  const sourceContent = await fsp.readFile(sourcePath, "utf-8");
  const prompt = buildPrdConversionPrompt(path.basename(sourcePath), sourceContent);
  const paths = resolvePaths(config);

  await ensureImportDirectories(paths.projectRoot, paths.specsDir, paths.logsDir);
  if (!options.overwrite) {
    const existing = await findExistingFiles(paths.projectRoot, PRD_REQUIRED_FILES);
    if (existing.length > 0) {
      throw new Error(`Refusing to overwrite existing files: ${existing.join(", ")}`);
    }
  }

  const rawOutput = await runRunnerWithRetry(config.runner, prompt, createSessionId(), logger, paths.projectRoot);
  const files = parsePrdConversionOutput(rawOutput, config.runner.outputFormat);

  if (!files) {
    throw new Error("Unable to parse PRD conversion output.");
  }

  const written = await writePrdFiles(paths.projectRoot, files, options.overwrite);
  await copySourcePrd(paths.projectRoot, sourcePath, options.overwrite);

  return {
    projectRoot: paths.projectRoot,
    sourceFile: sourcePath,
    filesWritten: written,
  };
}

export function analyzeResponse(text: string): RalphAnalysis {
  const statusBlock = extractStatusBlock(text);
  const analysisText = statusBlock ?? text;
  const completionMatches = COMPLETION_PATTERNS.filter((entry) =>
    entry.pattern.test(analysisText)
  ).map((entry) => entry.label);
  const pendingIndicators = PENDING_PATTERNS.filter((entry) =>
    entry.pattern.test(analysisText)
  ).map((entry) => entry.label);
  const exitSignal = statusBlock
    ? /EXIT_SIGNAL\s*:\s*true/i.test(statusBlock)
    : /EXIT_SIGNAL\s*:\s*true/i.test(text);

  return {
    exitSignal,
    completionIndicators: completionMatches.length,
    completionMatches,
    pendingIndicators,
  };
}

export function shouldExit(analysis: RalphAnalysis, threshold: number): boolean {
  return (
    analysis.exitSignal &&
    analysis.completionIndicators >= threshold &&
    analysis.pendingIndicators.length === 0
  );
}

export function extractRalphSummary(text: string): string | null {
  const match = text.match(/SUMMARY:\s*(.+)/i);
  if (!match) return null;
  return match[1].trim() || null;
}

export function buildCommitMessage(prefix: string, summary: string | null): string {
  const cleanPrefix = prefix.trim() || DEFAULT_COMMIT_PREFIX;
  if (summary) return `${cleanPrefix} ${summary}`;
  return `${cleanPrefix} completion`;
}

export async function runRalphLoop(
  config: RalphConfig,
  options: {
    loops?: number;
    logger?: Console;
    agent?: string;
    runForever?: boolean;
    continueOnError?: boolean;
    runnerRetryLimit?: number;
    runnerRetryDelayMs?: number;
  } = {}
): Promise<RalphLoopResult> {
  const logger = options.logger ?? console;
  const paths = await ensureProjectStructure(config);
  const loops = options.loops ?? config.maxLoops;
  const agent = options.agent ?? config.agent;
  const runForever = options.runForever ?? config.runForever ?? loops <= 0;
  const continueOnError = options.continueOnError ?? config.runner.continueOnError;
  const runnerRetryLimit = options.runnerRetryLimit ?? config.runner.retryLimit;
  const runnerRetryDelayMs = options.runnerRetryDelayMs ?? config.runner.retryDelayMs;

  let lastResponse = "";
  let lastAnalysis: RalphAnalysis = {
    exitSignal: false,
    completionIndicators: 0,
    completionMatches: [],
    pendingIndicators: [],
  };

  const session = await loadOrCreateSession(paths.sessionPath, config.sessionTimeoutHours);
  await writeSession(paths.sessionPath, session);

  let loopsRun = 0;

  let loopIndex = 0;
  while (runForever || loopIndex < loops) {
    const loopNumber = loopIndex + 1;
    const prompt = await buildRalphPrompt(paths, agent);
    let text = "";
    try {
      const response = await runRunnerWithRetry(
        {
          ...config.runner,
          continueOnError,
          retryLimit: runnerRetryLimit,
          retryDelayMs: runnerRetryDelayMs,
        },
        prompt,
        session.sessionId,
        logger,
        config.projectRoot
      );
      text = extractTextFromRunnerOutput(response, config.runner.outputFormat);
    } catch (error) {
      if (!continueOnError) {
        throw error;
      }
      const now = new Date().toISOString();
      await writeHeartbeat(paths.heartbeatPath, {
        sessionId: session.sessionId,
        lastRun: now,
        lastLoop: loopNumber,
        lastAnalysis,
        heartbeatAt: now,
      });
      session.lastRun = now;
      await writeSession(paths.sessionPath, session);
      loopIndex += 1;
      await sleep(runnerRetryDelayMs);
      continue;
    }

    lastResponse = text;
    lastAnalysis = analyzeResponse(text);

    await appendLog(paths.logPath, {
      loop: loopNumber,
      response: text,
      analysis: lastAnalysis,
    });
    await writeHeartbeat(paths.heartbeatPath, {
      sessionId: session.sessionId,
      lastRun: new Date().toISOString(),
      lastLoop: loopNumber,
      lastAnalysis,
      heartbeatAt: new Date().toISOString(),
    });
    session.lastRun = new Date().toISOString();
    await writeSession(paths.sessionPath, session);
    loopsRun = loopNumber;
    loopIndex += 1;

    if (!runForever && shouldExit(lastAnalysis, config.exitIndicatorThreshold)) {
      logger.info("Ralph exit conditions met.");
      break;
    }
  }

  if (!runForever && shouldExit(lastAnalysis, config.exitIndicatorThreshold)) {
    await maybeCommitOnExit(config, lastResponse, logger);
  }

  return {
    loopsRun,
    lastResponse,
    lastAnalysis,
  };
}

export async function readHeartbeat(paths: RalphPaths): Promise<RalphHeartbeat | null> {
  if (!(await fileExists(paths.heartbeatPath))) return null;
  try {
    const parsed = JSON.parse(
      await fsp.readFile(paths.heartbeatPath, "utf-8")
    ) as RalphHeartbeat;
    if (!parsed?.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function heartbeatStatus(config: RalphConfig): Promise<RalphHeartbeat> {
  const paths = resolvePaths(config);
  const heartbeat = await readHeartbeat(paths);
  if (heartbeat) return heartbeat;
  return {
    sessionId: "",
    lastRun: null,
    lastLoop: null,
    lastAnalysis: null,
    heartbeatAt: null,
  };
}

export async function touchHeartbeat(config: RalphConfig): Promise<RalphHeartbeat> {
  const paths = resolvePaths(config);
  if (!(await fileExists(paths.projectRoot))) {
    return {
      sessionId: "",
      lastRun: null,
      lastLoop: null,
      lastAnalysis: null,
      heartbeatAt: new Date().toISOString(),
    };
  }
  const existing = await readHeartbeat(paths);
  const session = await readSession(paths.sessionPath);
  const heartbeat: RalphHeartbeat = {
    sessionId: existing?.sessionId ?? session?.sessionId ?? "",
    lastRun: existing?.lastRun ?? session?.lastRun ?? null,
    lastLoop: existing?.lastLoop ?? null,
    lastAnalysis: existing?.lastAnalysis ?? null,
    heartbeatAt: new Date().toISOString(),
  };
  await writeHeartbeat(paths.heartbeatPath, heartbeat);
  return heartbeat;
}

async function runRunner(
  runner: RunnerConfig,
  prompt: string,
  sessionId: string,
  logger: Console,
  cwd?: string
): Promise<string> {
  const args = substituteArgs(runner, prompt, sessionId);
  try {
    const result = await execFileAsync(runner.command, args, { encoding: "utf-8", cwd });
    return result.stdout.trim();
  } catch (error: any) {
    const message = String(error?.message || error);
    logger.error(`Runner failed: ${message}`);
    throw error;
  }
}

async function runRunnerWithRetry(
  runner: RunnerConfig,
  prompt: string,
  sessionId: string,
  logger: Console,
  cwd?: string
): Promise<string> {
  const attempts = Math.max(1, 1 + runner.retryLimit);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runRunner(runner, prompt, sessionId, logger, cwd);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      logger.warn(
        `Runner attempt ${attempt} failed. Retrying in ${runner.retryDelayMs}ms.`
      );
      await sleep(runner.retryDelayMs);
    }
  }
  throw lastError;
}

async function maybeCommitOnExit(
  config: RalphConfig,
  responseText: string,
  logger: Console
): Promise<void> {
  if (!config.git.enabled || !config.git.onExit) return;
  if (!(await gitIsRepo(config.projectRoot))) return;

  const hasChanges = await gitHasChanges(config.projectRoot);
  if (!hasChanges) return;

  const summary = extractRalphSummary(responseText);
  const message = buildCommitMessage(config.git.commitPrefix, summary);
  await gitCommit(config.projectRoot, message);

  if (config.git.push) {
    const branch = await gitCurrentBranch(config.projectRoot);
    const remote = config.git.remote ?? "origin";
    await gitPush(config.projectRoot, remote, branch);
  }
}

function substituteArgs(runner: RunnerConfig, prompt: string, sessionId: string): string[] {
  return runner.args.map((arg) => {
    return arg
      .replace("{prompt}", prompt)
      .replace("{outputFormat}", runner.outputFormat)
      .replace("{allowedTools}", runner.allowedTools ?? "")
      .replace("{sessionId}", sessionId);
  });
}

function extractTextFromRunnerOutput(output: string, outputFormat: "json" | "text"): string {
  if (outputFormat === "text") return output;

  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return output;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return extractTextFromJson(parsed) ?? output;
  } catch {
    return output;
  }
}

function extractTextFromJson(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => extractTextFromJson(item)).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.output === "string") return value.output;
    if (typeof value.result === "string") return value.result;
    if (typeof value.message === "string") return value.message;
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) {
      return value.content
        .map((item: any) =>
          typeof item?.text === "string" ? item.text : extractTextFromJson(item)
        )
        .filter(Boolean)
        .join("\n");
    }
  }

  return null;
}

function parsePrdFilesFromJson(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return parsePrdFilesFromJsonValue(parsed);
  } catch {
    return null;
  }
}

function parsePrdFilesFromJsonValue(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object") return null;

  const direct = parsePrdFilesObject(value as Record<string, unknown>);
  if (direct) return direct;

  const wrapper = (value as Record<string, unknown>).files;
  if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
    const wrapped = parsePrdFilesObject(wrapper as Record<string, unknown>);
    if (wrapped) return wrapped;
  }

  const textCandidate = extractTextFromJson(value);
  if (textCandidate) {
    return parsePrdFilesFromJson(textCandidate) ?? parsePrdFilesFromText(textCandidate);
  }

  return null;
}

function parsePrdFilesObject(
  value: Record<string, unknown>
): Record<string, string> | null {
  const files: Record<string, string> = {};
  for (const [key, content] of Object.entries(value)) {
    if (typeof content === "string") {
      files[key] = content;
    }
  }

  if (Object.keys(files).length === 0) return null;
  return files;
}

function parsePrdFilesFromText(raw: string): Record<string, string> | null {
  const matches = [...raw.matchAll(/^FILE:\s*(.+)\n```[a-zA-Z0-9_-]*\n([\s\S]*?)```/gm)];
  if (matches.length === 0) return null;

  const files: Record<string, string> = {};
  for (const match of matches) {
    const name = match[1]?.trim();
    const content = match[2] ?? "";
    if (name) {
      files[name] = content.trimEnd();
    }
  }

  return Object.keys(files).length > 0 ? files : null;
}

function formatJsonPrdSummary(sourceContent: string): string | null {
  const parsed = tryParseJson(sourceContent);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const value = parsed as Record<string, unknown>;
  const hasKnownFields =
    "project" in value ||
    "description" in value ||
    "userStories" in value ||
    "branchName" in value;
  if (!hasKnownFields) return null;

  const lines: string[] = [];
  const project = readString(value.project);
  const branch = readString(value.branchName);
  const description = readString(value.description);
  if (project) lines.push(`Project: ${project}`);
  if (branch) lines.push(`Branch: ${branch}`);
  if (description) lines.push(`Description: ${description}`);

  const stories = Array.isArray(value.userStories) ? value.userStories : [];
  if (stories.length > 0) {
    lines.push("User stories:");
    for (const story of stories) {
      if (!story || typeof story !== "object") continue;
      const record = story as Record<string, unknown>;
      const id = readString(record.id);
      const title = readString(record.title);
      const storyDescription = readString(record.description);
      const priority = record.priority;
      const priorityLabel =
        typeof priority === "number" ? `P${priority}` : readString(priority);
      const header = [priorityLabel, id, title].filter(Boolean).join(" - ");
      if (header) {
        lines.push(`- ${header}`);
      }
      if (storyDescription) {
        lines.push(`  ${storyDescription}`);
      }

      const acceptance = Array.isArray(record.acceptanceCriteria)
        ? record.acceptanceCriteria
        : [];
      if (acceptance.length > 0) {
        lines.push("  Acceptance criteria:");
        for (const item of acceptance) {
          const entry = readString(item);
          if (entry) lines.push(`  - ${entry}`);
        }
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

function tryParseJson(sourceContent: string): unknown | null {
  const trimmed = sourceContent.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  return null;
}

async function ensureImportDirectories(
  projectRoot: string,
  specsDir: string,
  logsDir: string
): Promise<void> {
  await fsp.mkdir(projectRoot, { recursive: true });
  await fsp.mkdir(specsDir, { recursive: true });
  await fsp.mkdir(logsDir, { recursive: true });
}

async function findExistingFiles(
  projectRoot: string,
  files: readonly string[]
): Promise<string[]> {
  const existing: string[] = [];
  for (const file of files) {
    const target = path.resolve(projectRoot, file);
    if (await fileExists(target)) {
      existing.push(file);
    }
  }
  return existing;
}

async function writePrdFiles(
  projectRoot: string,
  files: Record<string, string>,
  overwrite = false
): Promise<string[]> {
  const missing = PRD_REQUIRED_FILES.filter((file) => !(file in files));
  if (missing.length > 0) {
    throw new Error(`Missing required files: ${missing.join(", ")}`);
  }

  const written: string[] = [];
  for (const [relative, content] of Object.entries(files)) {
    const target = path.resolve(projectRoot, relative);
    const safeRelative = path.relative(projectRoot, target);
    if (safeRelative.startsWith("..") || path.isAbsolute(safeRelative)) {
      throw new Error(`Refusing to write outside project root: ${relative}`);
    }

    if (!overwrite && (await fileExists(target))) {
      continue;
    }

    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, `${content.trimEnd()}\n`, "utf-8");
    written.push(relative);
  }

  return written;
}

async function copySourcePrd(
  projectRoot: string,
  sourcePath: string,
  overwrite = false
): Promise<void> {
  const targetPath = path.join(projectRoot, path.basename(sourcePath));
  if (!overwrite && (await fileExists(targetPath))) return;
  await fsp.copyFile(sourcePath, targetPath);
}

function extractStatusBlock(text: string): string | null {
  const match = text.match(/RALPH_STATUS:\s*([\s\S]*)$/i);
  if (!match) return null;
  return match[1].trim() || null;
}

function createSessionId(): string {
  return crypto.randomBytes(8).toString("hex");
}

async function loadOrCreateSession(
  filePath: string,
  timeoutHours: number
): Promise<RalphSession> {
  const existing = await readSession(filePath);
  if (!existing) {
    return { sessionId: createSessionId(), startedAt: new Date().toISOString() };
  }
  if (isSessionExpired(existing, timeoutHours)) {
    return { sessionId: createSessionId(), startedAt: new Date().toISOString() };
  }
  return existing;
}

async function readSession(filePath: string): Promise<RalphSession | null> {
  if (!(await fileExists(filePath))) return null;
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf-8")) as RalphSession;
    if (!parsed?.sessionId || !parsed?.startedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSessionExpired(session: RalphSession, timeoutHours: number): boolean {
  const reference = session.lastRun ?? session.startedAt;
  const referenceMs = new Date(reference).getTime();
  if (!Number.isFinite(referenceMs)) return true;
  const elapsedMs = Date.now() - referenceMs;
  return elapsedMs > timeoutHours * 60 * 60 * 1000;
}

async function writeSession(filePath: string, session: RalphSession): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

async function writeHeartbeat(filePath: string, heartbeat: RalphHeartbeat): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(heartbeat, null, 2), "utf-8");
}

async function appendLog(
  logPath: string,
  entry: { loop: number; response: string; analysis: RalphAnalysis }
): Promise<void> {
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  await fsp.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf-8");
}

async function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) return null;
  return await fsp.readFile(filePath, "utf-8");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitIsRepo(projectRoot: string): Promise<boolean> {
  try {
    const result = await execFileAsync("git", ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"]);
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function gitCurrentBranch(projectRoot: string): Promise<string> {
  const result = await execFileAsync("git", ["-C", projectRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
  return result.stdout.trim() || "main";
}

async function gitHasChanges(projectRoot: string): Promise<boolean> {
  const result = await execFileAsync("git", ["-C", projectRoot, "status", "--porcelain"]);
  return result.stdout.trim().length > 0;
}

async function gitCommit(projectRoot: string, message: string): Promise<void> {
  await execFileAsync("git", ["-C", projectRoot, "add", "-A"]);
  try {
    await execFileAsync("git", ["-C", projectRoot, "commit", "-m", message]);
  } catch (error: any) {
    const messageText = String(error?.message || "");
    if (messageText.includes("nothing to commit")) return;
    throw error;
  }
}

async function gitPush(projectRoot: string, remote: string, branch: string): Promise<void> {
  await execFileAsync("git", ["-C", projectRoot, "push", remote, branch]);
}
