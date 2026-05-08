import test from "node:test";
import assert from "node:assert/strict";
import { pickWindowsCommandCandidate } from "./commandExecutor.js";

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
