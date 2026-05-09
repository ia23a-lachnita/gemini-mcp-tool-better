import { spawn, spawnSync } from "child_process";
import { Logger } from "./logger.js";

function normalizeExecutablePath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getGeminiCliPathOverride(command: string): string | undefined {
  const override = process.env.GEMINI_CLI_PATH;
  if (command !== "gemini" || !override?.trim()) {
    return undefined;
  }
  return normalizeExecutablePath(override);
}

export function pickWindowsCommandCandidate(command: string, whereOutput: string): string {
  const lines = whereOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commandWithExtPattern = new RegExp(`[\\/]${escapedCommand}\\.(cmd|ps1|bat|exe)$`, "i");
  const commandWithoutExtPattern = new RegExp(`[\\\\/]${escapedCommand}$`, "i");
  const extensionPriority = ["cmd", "ps1", "bat", "exe"];

  const matchingCandidates = lines.filter((line) => commandWithExtPattern.test(line));
  for (const ext of extensionPriority) {
    const candidate = matchingCandidates.find((line) => line.toLowerCase().endsWith(`.${ext}`));
    if (candidate) {
      return candidate;
    }
  }

  for (const ext of extensionPriority) {
    const candidate = lines.find((line) => line.toLowerCase().endsWith(`.${ext}`));
    if (candidate) {
      return candidate;
    }
  }

  const extensionless = lines.find((line) => commandWithoutExtPattern.test(line));
  if (extensionless) {
    return extensionless;
  }

  return `${command}.cmd`;
}

function shouldSkipWindowsResolution(command: string): boolean {
  return (
    process.platform !== "win32" ||
    /\.[a-z0-9]+$/i.test(command) ||
    command.includes("\\") ||
    command.includes("/")
  );
}

export function resolveCommandForExecution(command: string): string {
  const overridePath = getGeminiCliPathOverride(command);
  if (overridePath) {
    return overridePath;
  }

  if (shouldSkipWindowsResolution(command)) {
    return command;
  }

  try {
    const whereResult = spawnSync("where", [command], {
      env: process.env,
      shell: false,
      encoding: "utf8",
    });
    const whereOutput = (whereResult.stdout || "").toString();
    if (whereResult.status === 0 && whereOutput.trim()) {
      return pickWindowsCommandCandidate(command, whereOutput);
    }
  } catch {
    // Fall through to conservative .cmd fallback.
  }

  return `${command}.cmd`;
}

function quoteForWindowsCmd(value: string): string {
  const escapedPercent = value.replace(/%/g, "%%");
  const escaped = escapedPercent.replace(/(["^&|<>])/g, "^$1");
  return `"${escaped}"`;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/\//g, "\\");
}

export function buildCommandExecutionPlan(
  resolvedCommand: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(resolvedCommand)) {
    const normalizedCommand = normalizeWindowsPath(resolvedCommand);
    const argString = args.map(quoteForWindowsCmd).join(" ");
    const commandString = `call ${quoteForWindowsCmd(normalizedCommand)}${argString ? ` ${argString}` : ""}`;
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandString],
    };
  }

  if (platform === "win32" && /\.ps1$/i.test(resolvedCommand)) {
    const normalizedCommand = normalizeWindowsPath(resolvedCommand);
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", normalizedCommand, ...args],
    };
  }

  return {
    command: resolvedCommand,
    args,
  };
}

export function getSpawnCommandPlan(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { resolvedCommand: string; command: string; args: string[] } {
  const resolvedCommand = resolveCommandForExecution(command);
  const executionPlan = buildCommandExecutionPlan(resolvedCommand, args, platform);
  return { resolvedCommand, ...executionPlan };
}

export function buildEnoentErrorMessage(command: string): string {
  return (
    `Gemini CLI not found: '${command}' could not be launched.\n` +
    `The Gemini CLI may work in your terminal but not in the MCP server process PATH.\n` +
    `To fix this:\n` +
    `  1. Find the full executable path:\n` +
    `       Windows: where gemini\n` +
    `       macOS/Linux: which gemini\n` +
    `  2. Add the Gemini CLI directory to your system PATH.\n` +
    `  3. Or set the GEMINI_CLI_PATH environment variable to the full path, for example:\n` +
    `       GEMINI_CLI_PATH=C:\\nvm4w\\nodejs\\gemini.cmd\n` +
    `       GEMINI_CLI_PATH=C:\\Users\\<user>\\AppData\\Local\\pnpm\\gemini.CMD`
  );
}

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const resolvedCommand = resolveCommandForExecution(command);
    const executionPlan = buildCommandExecutionPlan(resolvedCommand, args);
    Logger.commandExecution(executionPlan.command, executionPlan.args, startTime);

    const childProcess = spawn(executionPlan.command, executionPlan.args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let isResolved = false;
    let lastReportedLength = 0;
    
    childProcess.stdout.on("data", (data) => {
      stdout += data.toString();
      
      // Report new content if callback provided
      if (onProgress && stdout.length > lastReportedLength) {
        const newContent = stdout.substring(lastReportedLength);
        lastReportedLength = stdout.length;
        onProgress(newContent);
      }
    });


    // CLI level errors
    childProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      // find RESOURCE_EXHAUSTED when gemini-2.5-pro quota is exceeded
      if (stderr.includes("RESOURCE_EXHAUSTED")) {
        const modelMatch = stderr.match(/Quota exceeded for quota metric '([^']+)'/);
        const statusMatch = stderr.match(/status["\s]*[:=]\s*(\d+)/);
        const reasonMatch = stderr.match(/"reason":\s*"([^"]+)"/);
        const model = modelMatch ? modelMatch[1] : "Unknown Model";
        const status = statusMatch ? statusMatch[1] : "429";
        const reason = reasonMatch ? reasonMatch[1] : "rateLimitExceeded";
        const errorJson = {
          error: {
            code: parseInt(status),
            message: `GMCPT: --> Quota exceeded for ${model}`,
            details: {
              model: model,
              reason: reason,
              statusText: "Too Many Requests -- > try using gemini-2.5-flash by asking",
            }
          }
        };
        Logger.error(`Gemini Quota Error: ${JSON.stringify(errorJson, null, 2)}`);
      }
    });
    childProcess.on("error", (error) => {
      if (!isResolved) {
        isResolved = true;
        Logger.error(`Process error:`, error);
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error(buildEnoentErrorMessage(executionPlan.command)));
        } else {
          reject(new Error(`Failed to spawn command: ${error.message}`));
        }
      }
    });
    childProcess.on("close", (code) => {
      if (!isResolved) {
        isResolved = true;
        if (code === 0) {
          Logger.commandComplete(startTime, code, stdout.length);
          resolve(stdout.trim());
        } else {
          Logger.commandComplete(startTime, code);
          Logger.error(`Failed with exit code ${code}`);
          const errorMessage = stderr.trim() || "Unknown error";
          reject(
            new Error(`Command failed with exit code ${code}: ${errorMessage}`),
          );
        }
      }
    });
  });
}
