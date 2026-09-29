import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pkg = readJson("package.json");
const portable = readJson("plugins/simpleagentstore/plugin.json");
const codex = readJson("plugins/simpleagentstore/.codex-plugin/plugin.json");
const claude = readJson("plugins/simpleagentstore/.claude-plugin/plugin.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const requiredFiles = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs/GETTING_STARTED.md",
  "docs/COMPATIBILITY.md",
  "docs/DATABASE_OPERATIONS.md",
  "docs/DOCKER.md",
  "Dockerfile",
  "compose.yaml",
  ".dockerignore",
  "integrations/codex.toml",
  "integrations/mcp.json",
  "integrations/vscode.mcp.json",
  "plugins/simpleagentstore/skills/simpleagentstore-routing/SKILL.md",
];

assert(pkg.license === "Apache-2.0", "package.json must declare Apache-2.0");
assert(pkg.name === "simpleagentstore", "package name must match the project");
assert(pkg.private === true, "source-only release must not accidentally publish to npm");
assert(pkg.homepage === "https://simpleagentstore.com", "project homepage is incorrect");
assert(pkg.repository?.url === "git+https://github.com/darkrishabh/simpleagentstore.git", "repository URL is missing");
for (const [name, manifest] of Object.entries({ portable, codex, claude })) {
  assert(manifest.name === "simpleagentstore", `${name} manifest has the wrong name`);
  assert(manifest.version === pkg.version, `${name} version ${manifest.version} does not match core ${pkg.version}`);
}
const marketplacePlugin = claudeMarketplace.plugins?.find((plugin) => plugin.name === "simpleagentstore");
assert(marketplacePlugin?.version === pkg.version, "Claude marketplace version does not match core");
assert(marketplacePlugin.source === "./plugins/simpleagentstore", "Claude marketplace source is incorrect");
const codexEntry = codexMarketplace.plugins?.find((plugin) => plugin.name === pkg.name);
assert(codexEntry?.source?.path === "./plugins/simpleagentstore", "Codex marketplace source is incorrect");
assert(codexEntry?.policy?.installation === "AVAILABLE" && codexEntry?.policy?.authentication === "ON_INSTALL", "Codex marketplace policies are missing");
for (const file of requiredFiles) assert(existsSync(file), `missing required distribution file: ${file}`);

assert(codex.mcpServers === "./.mcp.json", "Codex compatibility manifest must bundle MCP");
const portableMcp = readJson("plugins/simpleagentstore/mcp.json");
const legacyMcp = readJson("plugins/simpleagentstore/.mcp.json");
for (const config of [portableMcp, legacyMcp, readJson("integrations/mcp.json")]) {
  assert(Object.keys(config.mcpServers).join() === "simpleagentstore", "bundle must expose exactly one MCP connection");
  assert(config.mcpServers.simpleagentstore.url === "http://127.0.0.1:4311/mcp", "bundled connection must stay loopback-only");
  assert(!config.mcpServers.simpleagentstore.headers, "do not distribute credentials");
}
assert(portableMcp.mcpServers.simpleagentstore.type === "streamable-http", "portable transport must use the portable schema");
assert(legacyMcp.mcpServers.simpleagentstore.type === "http", "Claude/legacy transport must use http");
assert(readJson("integrations/vscode.mcp.json").servers.simpleagentstore.url === legacyMcp.mcpServers.simpleagentstore.url, "VS Code endpoint drift");

const skill = readFileSync("plugins/simpleagentstore/skills/simpleagentstore-routing/SKILL.md", "utf8");
assert(/^---\n[\s\S]*?^name:\s*simpleagentstore-routing\s*$/m.test(skill), "routing skill frontmatter is invalid");
assert(/^description:\s*\S+/m.test(skill), "routing skill description is missing");

function sourceFiles(directory = ".") {
  const skippedDirectories = new Set([".git", "dist", "node_modules"]);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name).replace(/^\.\//, "");
    if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : sourceFiles(path);
    if (!entry.isFile()) return [];
    if (/^(?:\.env(?:\..*)?|\.DS_Store)$/.test(entry.name) && entry.name !== ".env.example") return [];
    if (/\.(?:sqlite(?:-shm|-wal)?|db(?:-shm|-wal)?|log|tgz)$/i.test(entry.name)) return [];
    return [path];
  });
}

let files;
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
  }).split("\0").filter((file) => file && existsSync(file));
} catch {
  files = sourceFiles();
}
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/,
];
const flagged = [];
for (const file of files) {
  assert(!/(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:sqlite|db)(?:-wal|-shm)?|[^/]+\.log)$/.test(file) || file === ".env.example", `private runtime file in distribution: ${file}`);
  if (/\.(?:png|jpg|jpeg|gif|webp|sqlite|db)$/i.test(file)) continue;
  const content = readFileSync(file, "utf8");
  const macHomePrefix = ["", "Users", ""].join("/");
  if (content.includes(macHomePrefix) || secretPatterns.some((pattern) => pattern.test(content))) flagged.push(file);
}
assert(flagged.length === 0, `possible private data in: ${flagged.join(", ")}`);

console.log(`Distribution validation passed (${files.length} files scanned).`);
