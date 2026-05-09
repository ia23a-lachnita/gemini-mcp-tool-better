import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  listGeminiConversations,
  readGeminiConversation,
  clearGeminiConversation,
  deleteGeminiConversation,
  prepareConversationContext,
  persistConversationTurn,
  getConversationStoragePath,
  getConversationDirectory,
} from "./conversationPersistence.js";

function createTempConversationDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-mcp-conversations-"));
}

test("no conversationId preserves one-shot behavior", () => {
  const context = prepareConversationContext("plain prompt", {});
  assert.equal(context.promptForGemini, "plain prompt");
  assert.equal(context.shouldSave, false);
  assert.equal(context.mode, "none");
});

test("same conversationId reuses prior turns", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("chat-1", "first user prompt", "first response");
  const context = prepareConversationContext("second user prompt", {
    conversationId: "chat-1",
  });

  assert.equal(context.promptForGemini.includes("first user prompt"), true);
  assert.equal(context.promptForGemini.includes("first response"), true);
  assert.equal(context.mode, "append");
  assert.equal(context.shouldSave, true);
});

test("different conversationId values do not share history", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("chat-a", "shared?", "no");
  const context = prepareConversationContext("new prompt", {
    conversationId: "chat-b",
  });

  assert.equal(context.promptForGemini, "new prompt");
});

test("readonly mode loads but does not save", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("chat-readonly", "prior question", "prior answer");
  const context = prepareConversationContext("current question", {
    conversationId: "chat-readonly",
    conversationMode: "readonly",
  });

  assert.equal(context.promptForGemini.includes("prior question"), true);
  assert.equal(context.shouldSave, false);
});

test("reset mode clears existing conversation before processing", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("chat-reset", "old question", "old answer");
  const resetContext = prepareConversationContext("fresh question", {
    conversationId: "chat-reset",
    conversationMode: "reset",
  });

  assert.equal(resetContext.promptForGemini, "fresh question");
  assert.equal(resetContext.shouldSave, true);

  const appendContext = prepareConversationContext("followup", {
    conversationId: "chat-reset",
    conversationMode: "append",
  });
  assert.equal(appendContext.promptForGemini, "followup");
});

test("turn limit and char limit bound replayed history", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("chat-limits", "u1", "r1");
  persistConversationTurn("chat-limits", "u2", "r2");
  persistConversationTurn("chat-limits", "u3-long", "r3-long");

  const byTurnContext = prepareConversationContext("next", {
    conversationId: "chat-limits",
    maxConversationTurns: 2,
    maxConversationChars: 1000,
  });
  assert.equal(byTurnContext.promptForGemini.includes("u1"), false);
  assert.equal(byTurnContext.promptForGemini.includes("u2"), true);
  assert.equal(byTurnContext.promptForGemini.includes("u3-long"), true);

  const byCharContext = prepareConversationContext("next", {
    conversationId: "chat-limits",
    maxConversationTurns: 10,
    maxConversationChars: 8,
  });
  assert.equal(byCharContext.promptForGemini.includes("u2"), false);
  assert.equal(byCharContext.promptForGemini.includes("u3-long"), true);
});

test("unsafe conversation IDs cannot escape conversation directory", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  const resolvedDir = path.resolve(getConversationDirectory());
  const unsafeIds = [
    "../../etc/passwd",
    "/etc/passwd",
    "..\\..\\windows\\system32",
    "name\u0000withnull",
    "name:with|special\"chars'",
    "x".repeat(2048),
  ];

  for (const unsafeId of unsafeIds) {
    const filePath = getConversationStoragePath(unsafeId);
    const resolvedFile = path.resolve(filePath);
    assert.equal(resolvedFile.startsWith(`${resolvedDir}${path.sep}`), true);
    assert.equal(path.relative(resolvedDir, resolvedFile).includes(".."), false);
  }
});

test("listGeminiConversations returns summaries sorted by updated time", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("list-a", "u1", "r1");
  persistConversationTurn("list-b", "u2", "r2");
  persistConversationTurn("list-b", "u3", "r3");

  const summaries = listGeminiConversations();
  assert.equal(summaries.length >= 2, true);
  assert.equal(summaries[0].conversationId, "list-b");
  assert.equal(summaries[0].turnCount >= 2, true);
});

test("listing recovers conversationId from file content", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  const manualFile = path.join(dir, "manual.json");
  fs.writeFileSync(
    manualFile,
    JSON.stringify({ conversationId: "manual-id", turns: [] }, null, 2),
    "utf8",
  );

  const summaries = listGeminiConversations();
  assert.equal(summaries.some((summary) => summary.conversationId === "manual-id"), true);
});

test("readGeminiConversation returns recent turns", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("read-1", "u1", "r1");
  persistConversationTurn("read-1", "u2", "r2");
  persistConversationTurn("read-1", "u3", "r3");

  const details = readGeminiConversation("read-1", 2);
  assert.equal(details.turnCount, 3);
  assert.equal(details.returnedTurns, 2);
  assert.equal(details.turns[0].userPrompt, "u2");
});

test("clearGeminiConversation removes turns but keeps file", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("clear-1", "u1", "r1");
  const filePath = getConversationStoragePath("clear-1");
  assert.equal(fs.existsSync(filePath), true);

  clearGeminiConversation("clear-1");
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as { turns: unknown[] };
  assert.equal(Array.isArray(data.turns), true);
  assert.equal(data.turns.length, 0);
});

test("deleteGeminiConversation removes the file", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  persistConversationTurn("delete-1", "u1", "r1");
  const filePath = getConversationStoragePath("delete-1");
  assert.equal(fs.existsSync(filePath), true);

  deleteGeminiConversation("delete-1");
  assert.equal(fs.existsSync(filePath), false);
});

test("read/clear/delete error on missing conversation", () => {
  const dir = createTempConversationDir();
  process.env.GEMINI_MCP_CONVERSATION_DIR = dir;

  assert.throws(() => readGeminiConversation("missing"));
  assert.throws(() => clearGeminiConversation("missing"));
  assert.throws(() => deleteGeminiConversation("missing"));
});
