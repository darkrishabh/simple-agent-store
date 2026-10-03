import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { resolve, sep, extname } from "node:path";

const root = resolve("site");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate page IDs");
assert.equal((html.match(/<h1\b/g) ?? []).length, 1, "Exactly one primary heading is required");
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /rel="canonical" href="https:\/\/darkrishabh.github.io\/simple-agent-store\/"/);
assert.match(html, /single-user/);
assert.match(html, /lexical, not semantic/);
assert.match(html, /not a live chat/);
assert.match(html, /class="button secondary" href="https:\/\/simpleagentstore\.com">Use Cloud Hosted /, "Hero cloud CTA must link to the hosted website");
for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  if (target.startsWith("https://")) continue;
  if (target === "data:,") continue; // Empty favicon avoids an implicit missing /favicon.ico.
  if (target.startsWith("#")) { assert(ids.includes(target.slice(1)), `Broken anchor: ${target}`); continue; }
  assert(!/^[a-z]+:|^\//i.test(target), `Unsafe or project-path-breaking reference: ${target}`);
  const path = resolve(root, target.split("#")[0]);
  assert(path === root || path.startsWith(`${root}${sep}`), `Reference escapes site: ${target}`);
  assert(existsSync(path), `Missing site asset: ${target}`);
}
const allowed = new Set([".html", ".css", ".js", ".jpg", ".png", ".webp", ".svg", ".xml", ".txt"]);
let bytes = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!lstatSync(path).isSymbolicLink(), "No symlinks in the public artifact");
    if (entry.isDirectory()) { walk(path); continue; }
    assert(entry.name === ".nojekyll" || allowed.has(extname(path)), `Unexpected public file: ${entry.name}`);
    assert(!/(?:^\.env|\.sqlite|\.db|\.pem|\.key|\.log)/i.test(entry.name), `Private/runtime file: ${entry.name}`);
    bytes += lstatSync(path).size;
  }
}
walk(root);
assert(bytes < 6 * 1024 * 1024, "Static site exceeds the 6 MiB asset budget");
console.log(`Site check passed: local assets, anchors, project-relative paths and public artifact (${Math.ceil(bytes / 1024)} KiB).`);
