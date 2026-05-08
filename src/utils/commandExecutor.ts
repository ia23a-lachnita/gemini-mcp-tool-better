import { spawn, spawnSync } from "child_process";
import { Logger } from "./logger.js";

export function pickWindowsCommandCandidate(command: string, whereOutput: string): string {
  const lines = whereOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commandWithExtPattern = new RegExp(`[\\\\/]${escapedCommand}\\.(cmd|bat|exe)$`, "i");
  const commandWithoutExtPattern = new RegExp(`[\\\\/]${escapedCommand}$`, "i");

  const preferred = lines.find((line) => commandWithExtPattern.test(line));
  if (preferred) {
    return preferred;
  }

  const anyExecutable = lines.find((line) => /\.(cmd|bat|exe)$/i.test(line));
  if (anyExecutable) {
    return anyExecutable;
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

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const resolvedCommand = resolveCommandForExecution(command);
    Logger.commandExecution(resolvedCommand, args, startTime);

    const childProcess = spawn(resolvedCommand, args, {
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
        reject(new Error(`Failed to spawn command: ${error.message}`));
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
