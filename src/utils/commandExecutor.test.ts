import test from "node:test";
import assert from "node:assert/strict";
import { buildCommandExecutionPlan, buildEnoentErrorMessage, pickWindowsCommandCandidate, resolveCommandForExecution } from "./commandExecutor.js";

test("prefers gemini.cmd style executable when where returns multiple candidates", () => {
  const whereOutput = `C:\\nvm4w\\nodejs\\gemini
C:\\nvm4w\\nodejs\\gemini.cmd
C:\\Users\\testuser\\AppData\\Local\\pnpm\\gemini
C:\\Users\\testuser\\AppData\\Local\\pnpm\\gemini.CMD`;

  const selected = pickWindowsCommandCandidate("gemini", whereOutput);
  assert.equal(selected.toLowerCase().endsWith("gemini.cmd"), true);
});

test("supports case-insensitive executable extension matching", () => {
  const whereOutput = `C:\\tools\\gemini.CMD`;
  const selected = pickWindowsCommandCandidate("gemini", whereOutput);
  assert.equal(selected, "C:\\tools\\gemini.CMD");
});

test("falls back to command.cmd when no executable candidates are found", () => {
  const selected = pickWindowsCommandCandidate("gemini", "");
  assert.equal(selected, "gemini.cmd");
});

test("GEMINI_CLI_PATH overrides gemini executable resolution", () => {
  process.env.GEMINI_CLI_PATH = "C:\\nvm4w\\nodejs\\gemini.cmd";
  const resolved = resolveCommandForExecution("gemini");
  assert.equal(resolved, "C:\\nvm4w\\nodejs\\gemini.cmd");
  delete process.env.GEMINI_CLI_PATH;
});

test("GEMINI_CLI_PATH removes surrounding quotes", () => {
  process.env.GEMINI_CLI_PATH = "\"C:\\nvm4w\\nodejs\\gemini.cmd\"";
  const resolved = resolveCommandForExecution("gemini");
  assert.equal(resolved, "C:\\nvm4w\\nodejs\\gemini.cmd");
  delete process.env.GEMINI_CLI_PATH;
});

test("win32 .cmd execution is wrapped with cmd.exe /d /s /c", () => {
  const plan = buildCommandExecutionPlan(
    "C:\\nvm4w\\nodejs\\gemini.cmd",
    ["-p", "hello"],
    "win32",
  );
  assert.equal(plan.command, "cmd.exe");
  assert.deepEqual(plan.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(plan.args[3].includes('"C:\\nvm4w\\nodejs\\gemini.cmd"'), true);
});

test("win32 .bat execution is wrapped with cmd.exe /d /s /c", () => {
  const plan = buildCommandExecutionPlan(
    "C:\\tools\\gemini.bat",
    ["-p", "hello"],
    "win32",
  );
  assert.equal(plan.command, "cmd.exe");
  assert.deepEqual(plan.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(plan.args[3].includes('"C:\\tools\\gemini.bat"'), true);
});

test("ENOENT error message includes Gemini-specific guidance", () => {
  const msg = buildEnoentErrorMessage("gemini.cmd");
  assert.equal(msg.includes("Gemini CLI not found"), true);
  assert.equal(msg.includes("gemini.cmd"), true);
  assert.equal(msg.includes("where gemini"), true);
  assert.equal(msg.includes("which gemini"), true);
  assert.equal(msg.includes("GEMINI_CLI_PATH"), true);
  assert.equal(msg.includes("nvm4w"), true);
  assert.equal(msg.includes("pnpm"), true);
});

test("ENOENT error message mentions PATH and terminal context", () => {
  const msg = buildEnoentErrorMessage("cmd.exe");
  assert.equal(msg.includes("terminal"), true);
  assert.equal(msg.includes("PATH"), true);
});
