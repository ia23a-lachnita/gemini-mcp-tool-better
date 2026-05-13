import test from "node:test";
import assert from "node:assert/strict";
import { pingTool } from "./simple-tools.js";

test("ping returns message without shell command dependency", async () => {
  const result = await pingTool.execute({ prompt: "Gemini CLI is working!" });
  assert.equal(result, "Gemini CLI is working!");
});
