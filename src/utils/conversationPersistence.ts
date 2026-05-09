import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import { ConversationMode } from "../constants.js";

export interface ConversationTurn {
  userPrompt: string;
  geminiResponse: string;
  timestamp: string;
}

interface ConversationFile {
  conversationId: string;
  turns: ConversationTurn[];
}

const DEFAULT_CONVERSATION_DIR = path.join(os.homedir(), ".gemini-mcp-tool", "conversations");
const DEFAULT_MAX_CONVERSATION_TURNS = 10;
const DEFAULT_MAX_CONVERSATION_CHARS = 12000;
const MAX_CONVERSATION_PREFIX_LENGTH = 32;

export interface ConversationPrepareOptions {
  conversationId?: string;
  conversationMode?: ConversationMode;
  maxConversationTurns?: number;
  maxConversationChars?: number;
}

export interface PreparedConversationContext {
  promptForGemini: string;
  shouldSave: boolean;
  mode: ConversationMode;
  conversationId?: string;
}

function ensureConversationDir(): string {
  const dir = process.env.GEMINI_MCP_CONVERSATION_DIR?.trim() || DEFAULT_CONVERSATION_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getConversationFilePath(conversationId: string): string {
  const dir = ensureConversationDir();
  const hash = createHash("sha256").update(conversationId).digest("hex");
  // Keep prefix short for cross-platform filename compatibility.
  const safePrefix = (conversationId.replace(/[^a-zA-Z0-9_-]/g, "_") || "conversation")
    .slice(0, MAX_CONVERSATION_PREFIX_LENGTH);
  return path.join(dir, `${safePrefix}-${hash}.json`);
}

function loadConversation(conversationId: string): ConversationTurn[] {
  const filePath = getConversationFilePath(conversationId);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ConversationFile>;
  if (!Array.isArray(parsed.turns)) {
    return [];
  }

  return parsed.turns.filter(
    (turn) =>
      typeof turn?.userPrompt === "string" &&
      typeof turn?.geminiResponse === "string" &&
      typeof turn?.timestamp === "string",
  );
}

function saveConversation(conversationId: string, turns: ConversationTurn[]): void {
  const filePath = getConversationFilePath(conversationId);
  const data: ConversationFile = { conversationId, turns };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function clearConversation(conversationId: string): void {
  const filePath = getConversationFilePath(conversationId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function resolveConversationMode(
  conversationId?: string,
  conversationMode?: ConversationMode,
): ConversationMode {
  if (!conversationId) {
    return "none";
  }
  return conversationMode ?? "append";
}

export function getConversationDirectory(): string {
  return process.env.GEMINI_MCP_CONVERSATION_DIR?.trim() || DEFAULT_CONVERSATION_DIR;
}

export function getConversationStoragePath(conversationId: string): string {
  return getConversationFilePath(conversationId);
}

function applyTurnLimit(turns: ConversationTurn[], maxConversationTurns: number): ConversationTurn[] {
  // Defensive guard: <=0 means "replay nothing".
  if (maxConversationTurns <= 0) {
    return [];
  }
  return turns.slice(-maxConversationTurns);
}

function applyCharLimit(turns: ConversationTurn[], maxConversationChars: number): ConversationTurn[] {
  if (maxConversationChars <= 0) {
    return [];
  }

  const kept: ConversationTurn[] = [];
  let totalChars = 0;

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const turnChars = turn.userPrompt.length + turn.geminiResponse.length;
    const exceedsLimit = totalChars + turnChars > maxConversationChars;
    // Keep at least the most recent turn so replay context never becomes empty when history exists.
    if (exceedsLimit && kept.length === 0) {
      kept.unshift(turn);
      break;
    }
    if (exceedsLimit) {
      break;
    }
    kept.unshift(turn);
    totalChars += turnChars;
  }

  return kept;
}

function buildReplayPrompt(prompt: string, conversationId: string, turns: ConversationTurn[]): string {
  if (turns.length === 0) {
    return prompt;
  }

  const turnsText = turns
    .map(
      (turn, index) =>
        `Turn ${index + 1} - User:\n${turn.userPrompt}\n\nTurn ${index + 1} - Gemini:\n${turn.geminiResponse}`,
    )
    .join("\n\n---\n\n");

  return `[MCP MANAGED CONTEXT REPLAY]
Conversation: ${conversationId}
Note: This is MCP-managed context replay for one-shot Gemini CLI calls, not native Gemini CLI session persistence.

Prior conversation turns:
${turnsText}

Current user request:
${prompt}`;
}

export function prepareConversationContext(
  prompt: string,
  options: ConversationPrepareOptions,
): PreparedConversationContext {
  const mode = resolveConversationMode(options.conversationId, options.conversationMode);
  if (!options.conversationId || mode === "none") {
    return {
      promptForGemini: prompt,
      shouldSave: false,
      mode,
      conversationId: options.conversationId,
    };
  }

  if (mode === "reset") {
    clearConversation(options.conversationId);
    return {
      promptForGemini: prompt,
      shouldSave: true,
      mode,
      conversationId: options.conversationId,
    };
  }

  const maxTurns = options.maxConversationTurns ?? DEFAULT_MAX_CONVERSATION_TURNS;
  const maxChars = options.maxConversationChars ?? DEFAULT_MAX_CONVERSATION_CHARS;
  const loadedTurns = loadConversation(options.conversationId);
  const turnsByCount = applyTurnLimit(loadedTurns, maxTurns);
  const boundedTurns = applyCharLimit(turnsByCount, maxChars);

  return {
    promptForGemini: buildReplayPrompt(prompt, options.conversationId, boundedTurns),
    shouldSave: mode === "append",
    mode,
    conversationId: options.conversationId,
  };
}

export function persistConversationTurn(
  conversationId: string,
  userPrompt: string,
  geminiResponse: string,
): void {
  const turns = loadConversation(conversationId);
  turns.push({
    userPrompt,
    geminiResponse,
    timestamp: new Date().toISOString(),
  });
  saveConversation(conversationId, turns);
}
