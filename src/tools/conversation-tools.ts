import { z } from "zod";
import { UnifiedTool } from "./registry.js";
import {
  listGeminiConversations,
  readGeminiConversation,
  clearGeminiConversation,
  deleteGeminiConversation,
} from "../utils/conversationPersistence.js";

const listArgsSchema = z.object({});

export const listGeminiConversationsTool: UnifiedTool = {
  name: "list-gemini-conversations",
  description: "List persisted Gemini MCP conversations without dumping full content.",
  zodSchema: listArgsSchema,
  category: "utility",
  execute: async () => {
    const conversations = listGeminiConversations();
    return JSON.stringify({ conversations }, null, 2);
  },
};

const readArgsSchema = z.object({
  conversationId: z.string().min(1).describe("Conversation ID to read."),
  limitTurns: z.number().int().min(1).max(50).optional().describe("Max recent turns to return."),
});

export const readGeminiConversationTool: UnifiedTool = {
  name: "read-gemini-conversation",
  description: "Read recent turns from a persisted Gemini MCP conversation.",
  zodSchema: readArgsSchema,
  category: "utility",
  execute: async (args) => {
    const conversationId = args.conversationId as string | undefined;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    const limitTurns = typeof args.limitTurns === "number" ? args.limitTurns : undefined;
    const details = readGeminiConversation(conversationId, limitTurns ?? 5);
    return JSON.stringify(details, null, 2);
  },
};

const clearArgsSchema = z.object({
  conversationId: z.string().min(1).describe("Conversation ID to clear."),
});

export const clearGeminiConversationTool: UnifiedTool = {
  name: "clear-gemini-conversation",
  description: "Clear turns from a persisted Gemini MCP conversation but keep its file.",
  zodSchema: clearArgsSchema,
  category: "utility",
  execute: async (args) => {
    const conversationId = args.conversationId as string | undefined;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    clearGeminiConversation(conversationId);
    return JSON.stringify({ status: "cleared", conversationId }, null, 2);
  },
};

const deleteArgsSchema = z.object({
  conversationId: z.string().min(1).describe("Conversation ID to delete."),
});

export const deleteGeminiConversationTool: UnifiedTool = {
  name: "delete-gemini-conversation",
  description: "Delete a persisted Gemini MCP conversation file.",
  zodSchema: deleteArgsSchema,
  category: "utility",
  execute: async (args) => {
    const conversationId = args.conversationId as string | undefined;
    if (!conversationId) {
      throw new Error("conversationId is required");
    }
    deleteGeminiConversation(conversationId);
    return JSON.stringify({ status: "deleted", conversationId }, null, 2);
  },
};
