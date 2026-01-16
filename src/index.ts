import fsp from "fs/promises";
import path from "path";
import {
  analyzeResponse,
  buildRalphPrompt,
  ensureProjectStructure,
  getProjectConfig,
  heartbeatStatus,
  normalizePluginConfig,
  resolvePaths,
  runRalphLoop,
  shouldExit,
  touchHeartbeat,
  type RalphConfigInput,
} from "./ralph.js";

const PLUGIN_ID = "clawd-plugin-ralph";
const PLUGIN_NAME = "Clawdbot Ralph";

function readConfig(api: any, baseDir: string): RalphConfigInput {
  const entries = api?.config?.plugins?.entries || {};
  const entryConfig =
    entries[PLUGIN_ID]?.config || entries.ralph?.config || entries[PLUGIN_NAME]?.config;

  return {
    ...(entryConfig || {}),
    projectRoot: entryConfig?.projectRoot ?? baseDir,
  } as RalphConfigInput;
}

function createLogger(api: any): Console {
  return api?.logger || console;
}

export default {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  configSchema: {
    parse: (value: unknown) => value as RalphConfigInput,
    uiHints: {
      projectRoot: { label: "Project Root", placeholder: "/Users/you/project" },
      provider: { label: "Provider", placeholder: "claude" },
      exitIndicatorThreshold: { label: "Exit Indicator Threshold", placeholder: "2" },
      maxLoops: { label: "Max Loops", placeholder: "20" },
      sessionTimeoutHours: { label: "Session Timeout (hours)", placeholder: "24" },
      heartbeatFile: { label: "Heartbeat File", placeholder: ".ralph_heartbeat.json" },
      heartbeatIntervalMs: { label: "Heartbeat Interval (ms)", placeholder: "30000" },
      "git.enabled": { label: "Git Enabled" },
      "git.onExit": { label: "Git Commit On Exit" },
      "git.push": { label: "Git Push On Exit" },
      "git.commitPrefix": { label: "Git Commit Prefix", placeholder: "[ralph]" },
      "git.remote": { label: "Git Remote", placeholder: "origin" },
    },
  },
  register(api: any) {
    const logger = createLogger(api);
    const pluginConfig = normalizePluginConfig(readConfig(api, process.cwd()));

    const heartbeatTimers = new Map<string, NodeJS.Timeout>();

    const ensureAllProjects = async () => {
      for (const projectConfig of Object.values(pluginConfig.projects)) {
        await ensureProjectStructure(projectConfig);
      }
    };

    void ensureAllProjects().catch((error: any) => {
      logger.error(`Failed to initialize Ralph projects: ${String(error?.message || error)}`);
    });

    api.registerService({
      id: "ralph-heartbeat",
      start: () => {
        for (const [projectId, projectConfig] of Object.entries(pluginConfig.projects)) {
          if (projectConfig.heartbeatIntervalMs <= 0) continue;
          const tick = async () => {
            try {
              await touchHeartbeat(projectConfig);
            } catch (error: any) {
              logger.error(`Heartbeat failed: ${String(error?.message || error)}`);
            }
          };
          void tick();
          heartbeatTimers.set(
            projectId,
            setInterval(() => void tick(), projectConfig.heartbeatIntervalMs)
          );
        }
      },
      stop: () => {
        for (const timer of heartbeatTimers.values()) {
          clearInterval(timer);
        }
        heartbeatTimers.clear();
      },
    });

    api.registerCli(
      ({ program }: any) => {
        const ralph = program.command("ralph").description("Ralph agentic coding loop");

        ralph
          .command("init [directory]")
          .option("--force", "Overwrite templates", false)
          .option("-p, --project <id>", "Project id")
          .description("Initialize a Ralph project structure")
          .action(async (directory: string | undefined, options: any) => {
            const projectConfig = getProjectConfig(pluginConfig, options.project);
            const projectRoot = directory
              ? path.resolve(process.cwd(), directory)
              : projectConfig.projectRoot;
            const targetConfig = {
              ...projectConfig,
              projectRoot,
            };
            await ensureProjectStructure(targetConfig, { overwrite: options.force });
            console.log(`Ralph project ready at ${projectRoot}`);
          });

        ralph
          .command("prompt")
          .description("Print the compiled Ralph prompt")
          .option("-p, --project <id>", "Project id")
          .action(async (options: any) => {
            const projectConfig = getProjectConfig(pluginConfig, options.project);
            const paths = resolvePaths(projectConfig);
            const prompt = await buildRalphPrompt(paths);
            console.log(prompt);
          });

        ralph
          .command("run")
          .option("-l, --loops <count>", "Number of loops to run")
          .option("-p, --project <id>", "Project id")
          .option("--json", "Output JSON", false)
          .description("Run the Ralph loop")
          .action(async (options: any) => {
            const projectConfig = getProjectConfig(pluginConfig, options.project);
            const parsedLoops = Number.parseInt(options.loops, 10);
            const loops = Number.isNaN(parsedLoops) ? projectConfig.maxLoops : parsedLoops;
            const result = await runRalphLoop(projectConfig, { loops, logger });

            if (options.json) {
              console.log(JSON.stringify(result, null, 2));
              return;
            }

            console.log(`Loops run: ${result.loopsRun}`);
            console.log(`Exit signal: ${result.lastAnalysis.exitSignal}`);
            console.log(`Completion indicators: ${result.lastAnalysis.completionIndicators}`);
          });

        ralph
          .command("status")
          .option("--json", "Output JSON", false)
          .option("-p, --project <id>", "Project id")
          .description("Show the latest Ralph heartbeat status")
          .action(async (options: any) => {
            const projectConfig = getProjectConfig(pluginConfig, options.project);
            const status = await heartbeatStatus(projectConfig);
            if (options.json) {
              console.log(JSON.stringify(status, null, 2));
              return;
            }

            if (!status.sessionId) {
              console.log("No heartbeat yet. Run a loop to start one.");
              return;
            }

            console.log(`Session: ${status.sessionId}`);
            console.log(`Last run: ${status.lastRun ?? "unknown"}`);
            console.log(`Last loop: ${status.lastLoop ?? "unknown"}`);
            console.log(`Heartbeat: ${status.heartbeatAt ?? "unknown"}`);
            console.log(
              `Exit signal: ${status.lastAnalysis?.exitSignal ?? "unknown"}`
            );
          });

        ralph
          .command("analyze [text...]")
          .option("-f, --file <path>", "Read response from a file")
          .option("-t, --threshold <count>", "Exit threshold")
          .option("-p, --project <id>", "Project id")
          .option("--json", "Output JSON", false)
          .description("Analyze a response for exit conditions")
          .action(async (textParts: string[], options: any) => {
            const projectConfig = getProjectConfig(pluginConfig, options.project);
            let content = textParts.join(" ").trim();
            if (options.file) {
              content = await fsp.readFile(path.resolve(process.cwd(), options.file), "utf-8");
            }

            if (!content) {
              throw new Error("Provide text or --file");
            }

            const analysis = analyzeResponse(content);
            const parsedThreshold = Number.parseInt(options.threshold, 10);
            const threshold = Number.isNaN(parsedThreshold)
              ? projectConfig.exitIndicatorThreshold
              : parsedThreshold;
            const result = {
              ...analysis,
              shouldExit: shouldExit(analysis, threshold),
            };

            if (options.json) {
              console.log(JSON.stringify(result, null, 2));
              return;
            }

            console.log(`Exit signal: ${result.exitSignal}`);
            console.log(`Completion indicators: ${result.completionIndicators}`);
            console.log(`Should exit: ${result.shouldExit}`);
          });
      },
      { commands: ["ralph"] }
    );

    api.registerTool({
      name: "ralph_init_project",
      description: "Initialize a Ralph project structure.",
      parameters: {
        type: "object",
        properties: {
          directory: { type: "string" },
          overwrite: { type: "boolean" },
          projectId: { type: "string" },
        },
      },
      async execute(_id: string, params: any) {
        const projectConfig = getProjectConfig(pluginConfig, params?.projectId);
        const projectRoot = params?.directory
          ? path.resolve(process.cwd(), params.directory)
          : projectConfig.projectRoot;
        const targetConfig = {
          ...projectConfig,
          projectRoot,
        };
        await ensureProjectStructure(targetConfig, { overwrite: Boolean(params?.overwrite) });
        return {
          content: [
            {
              type: "text",
              text: `Ralph project ready at ${projectRoot}`,
            },
          ],
        };
      },
    });

    api.registerTool({
      name: "ralph_next_prompt",
      description: "Get the compiled Ralph prompt.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
      },
      async execute(_id: string, params: any) {
        const projectConfig = getProjectConfig(pluginConfig, params?.projectId);
        const paths = resolvePaths(projectConfig);
        const prompt = await buildRalphPrompt(paths);
        return {
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        };
      },
    });

    api.registerTool({
      name: "ralph_analyze_response",
      description: "Analyze a response for Ralph exit conditions.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          threshold: { type: "number" },
          projectId: { type: "string" },
        },
        required: ["text"],
      },
      async execute(_id: string, params: any) {
        const projectConfig = getProjectConfig(pluginConfig, params?.projectId);
        const analysis = analyzeResponse(params.text);
        const threshold = typeof params.threshold === "number"
          ? params.threshold
          : projectConfig.exitIndicatorThreshold;
        const result = {
          ...analysis,
          shouldExit: shouldExit(analysis, threshold),
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    });

    api.registerTool({
      name: "ralph_status",
      description: "Get the latest Ralph heartbeat status.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
        },
      },
      async execute(_id: string, params: any) {
        const projectConfig = getProjectConfig(pluginConfig, params?.projectId);
        const status = await heartbeatStatus(projectConfig);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      },
    });
  },
};
