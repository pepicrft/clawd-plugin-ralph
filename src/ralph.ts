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
};

export type RalphProjectConfigInput = {
  projectRoot?: string;
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
  sessionTimeoutHours?: number;
  runner?: RunnerConfigInput;
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
};

export type RalphConfig = {
  projectRoot: string;
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
  sessionTimeoutHours: number;
  runner: RunnerConfig;
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

const execFileAsync = promisify(execFile);

const DEFAULT_PROMPT_FILE = "PROMPT.md";
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
const DEFAULT_SESSION_TIMEOUT = 24;

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
    return { command: "codex", args: ["--prompt", "{prompt}"], outputFormat: "text" };
  }
  return { command: "claude", args: ["-p", "{prompt}"], outputFormat: "text" };
}

export function normalizeConfig(
  input: RalphProjectConfigInput,
  baseDir: string = process.cwd()
): RalphConfig {
  const projectRoot = input.projectRoot ?? baseDir;
  const provider = input.provider ?? "claude";
  const runnerDefaults = defaultRunner(provider);
  const runnerInput = input.runner ?? {};
  const runner: RunnerConfig = {
    command: runnerInput.command ?? runnerDefaults.command,
    args: runnerInput.args ?? runnerDefaults.args,
    outputFormat: runnerInput.outputFormat ?? runnerDefaults.outputFormat,
    allowedTools: runnerInput.allowedTools,
  };

  return {
    projectRoot,
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
    maxLoops: input.maxLoops ?? DEFAULT_MAX_LOOPS,
    sessionTimeoutHours: input.sessionTimeoutHours ?? DEFAULT_SESSION_TIMEOUT,
    runner,
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

async function writeIfMissing(
  filePath: string,
  contents: string,
  overwrite?: boolean
): Promise<void> {
  if (!overwrite && (await fileExists(filePath))) return;
  await fsp.writeFile(filePath, contents, "utf-8");
}

export async function buildRalphPrompt(paths: RalphPaths): Promise<string> {
  const prompt = await readFileIfExists(paths.promptPath);
  const plan = await readFileIfExists(paths.planPath);
  const agent = await readFileIfExists(paths.agentPath);

  const sections = [
    "# Ralph Instructions",
    RALPH_STATUS_INSTRUCTIONS,
    "## PROMPT.md",
    prompt || "(missing PROMPT.md)",
    "## @fix_plan.md",
    plan || "(missing @fix_plan.md)",
    "## @AGENT.md",
    agent || "(missing @AGENT.md)",
  ];

  return sections.join("\n\n");
}

export function analyzeResponse(text: string): RalphAnalysis {
  const completionMatches = COMPLETION_PATTERNS.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.label
  );
  const pendingIndicators = PENDING_PATTERNS.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.label
  );
  const exitSignal = /EXIT_SIGNAL\s*:\s*true/i.test(text);

  return {
    exitSignal,
    completionIndicators: completionMatches.length,
    completionMatches,
    pendingIndicators,
  };
}

export function shouldExit(analysis: RalphAnalysis, threshold: number): boolean {
  return analysis.exitSignal && analysis.completionIndicators >= threshold;
}

export async function runRalphLoop(
  config: RalphConfig,
  options: { loops?: number; logger?: Console } = {}
): Promise<RalphLoopResult> {
  const logger = options.logger ?? console;
  const paths = await ensureProjectStructure(config);
  const loops = options.loops ?? config.maxLoops;

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

  for (let i = 0; i < loops; i += 1) {
    const prompt = await buildRalphPrompt(paths);
    const response = await runRunner(config.runner, prompt, session.sessionId, logger);
    const text = extractTextFromRunnerOutput(response, config.runner.outputFormat);

    lastResponse = text;
    lastAnalysis = analyzeResponse(text);

    await appendLog(paths.logPath, {
      loop: i + 1,
      response: text,
      analysis: lastAnalysis,
    });
    await writeHeartbeat(paths.heartbeatPath, {
      sessionId: session.sessionId,
      lastRun: new Date().toISOString(),
      lastLoop: i + 1,
      lastAnalysis,
      heartbeatAt: new Date().toISOString(),
    });
    session.lastRun = new Date().toISOString();
    await writeSession(paths.sessionPath, session);
    loopsRun = i + 1;

    if (shouldExit(lastAnalysis, config.exitIndicatorThreshold)) {
      logger.info("Ralph exit conditions met.");
      break;
    }
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
  logger: Console
): Promise<string> {
  const args = substituteArgs(runner, prompt, sessionId);
  try {
    const result = await execFileAsync(runner.command, args, { encoding: "utf-8" });
    return result.stdout.trim();
  } catch (error: any) {
    const message = String(error?.message || error);
    logger.error(`Runner failed: ${message}`);
    throw error;
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
  const startedAt = new Date(session.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return true;
  const elapsedMs = Date.now() - startedAt;
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
