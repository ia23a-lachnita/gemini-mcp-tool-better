# Installation

Multiple ways to install Gemini MCP Tool, depending on your needs.

## Prerequisites

- Node.js v16.0.0 or higher
- Claude Desktop or Claude Code with MCP support
- Gemini CLI installed (`npm install -g @google/gemini-cli`)

## Method 1: NPX (Recommended)

No installation needed - runs directly:

```json
{
  "mcpServers": {
    "gemini-cli": {
      "command": "npx",
      "args": ["-y", "gemini-mcp-tool"]
    }
  }
}
```

### GitHub Fork via npx (Windows example)

```cmd
claude mcp add gemini-cli -e GEMINI_CLI_PATH="C:\nvm4w\nodejs\gemini.cmd" -- npx -y github:ia23a-lachnita/gemini-mcp-tool-better
```

Replace `GEMINI_CLI_PATH` with the actual path to your local Gemini CLI executable.

## Method 2: Global Installation

```bash
claude mcp add gemini-cli -- npx -y gemini-mcp-tool
```

Then configure:
```json
{
  "mcpServers": {
    "gemini-cli": {
      "command": "gemini-mcp"
    }
  }
}
```

## Method 3: Local Project

```bash
npm install gemini-mcp-tool
```

See [Getting Started](/getting-started) for full setup instructions.
