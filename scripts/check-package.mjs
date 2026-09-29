// Check the actual npm archive manifest, not just .gitignore expectations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const [archive] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }));
const paths = archive.files.map((file) => file.path);
const forbidden = paths.filter((path) =>
  /(^|\/)(?:node_modules|\.git|backups)(\/|$)/.test(path) ||
  /(^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example" ||
  /\.(?:sqlite|db)(?:-wal|-shm)?$|\.(?:pem|key|log|tgz)$/i.test(path) ||
  path.startsWith("data/") && path !== "data/.gitkeep"
);
assert.deepEqual(forbidden, [], "Private/runtime files must not ship in the source package");
for (const required of ["LICENSE", "README.md", "SECURITY.md", "compose.yaml", "src/store.ts", "web/index.html", "plugins/simpleagentstore/plugin.json", "plugins/simpleagentstore/.codex-plugin/plugin.json", "plugins/simpleagentstore/.claude-plugin/plugin.json", "plugins/simpleagentstore/mcp.json", "plugins/simpleagentstore/.mcp.json", "plugins/simpleagentstore/skills/simpleagentstore-routing/SKILL.md"]) {
  assert(paths.includes(required), `Missing packaged file: ${required}`);
}
console.log(`Package check passed: ${archive.name}@${archive.version}, ${paths.length} files, no runtime data or environment secrets.`);
