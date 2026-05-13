import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiArgs, resolveApprovalMode } from "./geminiExecutor.js";

test("plan mode is the default approval flag", () => {
  delete process.env.GEMINI_MCP_APPROVAL_MODE;
  const args = buildGeminiArgs("hello", {});
  assert.equal(args.includes("--approval-mode=plan"), true);
  assert.equal(args.includes("--approval-mode=yolo"), false);
});

test("approvalMode yolo adds --approval-mode=yolo", () => {
  const args = buildGeminiArgs("hello", { approvalMode: "yolo" });
  assert.equal(args.includes("--approval-mode=yolo"), true);
});

test("env approval mode works", () => {
  process.env.GEMINI_MCP_APPROVAL_MODE = "plan";
  assert.equal(resolveApprovalMode(), "plan");
  const args = buildGeminiArgs("hello", {});
  assert.equal(args.includes("--approval-mode=plan"), true);
  delete process.env.GEMINI_MCP_APPROVAL_MODE;
});

test("tool argument approval mode overrides env var", () => {
  process.env.GEMINI_MCP_APPROVAL_MODE = "plan";
  const args = buildGeminiArgs("hello", { approvalMode: "yolo" });
  assert.equal(args.includes("--approval-mode=yolo"), true);
  assert.equal(args.includes("--approval-mode=plan"), false);
  delete process.env.GEMINI_MCP_APPROVAL_MODE;
});
