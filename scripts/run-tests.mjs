import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectTestFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const root = resolve(process.cwd(), "src");
  let testFiles = [];
  try {
    testFiles = await collectTestFiles(root);
  } catch (error) {
    console.error("Failed to discover test files.");
    console.error(error);
    process.exit(1);
  }

  if (testFiles.length === 0) {
    console.error("No test files found under src.");
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const tsxPackagePath = require.resolve("tsx/package.json");
  const tsxPackageJson = JSON.parse(await readFile(tsxPackagePath, "utf8"));
  const binEntry = typeof tsxPackageJson.bin === "string" ? tsxPackageJson.bin : tsxPackageJson.bin?.tsx;
  if (!binEntry) {
    console.error("Unable to resolve tsx CLI path from package.json bin.");
    process.exit(1);
  }
  const tsxCliPath = resolve(tsxPackagePath, "..", binEntry);

  const child = spawn(
    process.execPath,
    [tsxCliPath, "--test", "--test-concurrency=1", ...testFiles],
    { stdio: "inherit" }
  );

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

main();
