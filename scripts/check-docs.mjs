import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const rootDocuments = [
  "README.md",
  "OSS_READINESS.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
];

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === ".md" ? [path] : [];
  });
}

function githubSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

const files = [
  ...rootDocuments.filter(existsSync).map((path) => resolve(path)),
  ...markdownFiles(resolve("docs")),
  ...markdownFiles(resolve("plugins")),
];
const failures = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if ((content.match(/^```/gm) ?? []).length % 2 !== 0) {
    failures.push(`${file}: unbalanced fenced code blocks`);
  }

  const anchors = new Set(
    [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => githubSlug(match[1])),
  );
  const links = content.matchAll(/\[[^\]]*\]\(([^)]+)\)|(?:href|src)="([^"]+)"/g);
  for (const match of links) {
    const target = (match[1] ?? match[2]).trim();
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    if (target.startsWith("#")) {
      if (!anchors.has(target.slice(1))) failures.push(`${file}: missing anchor ${target}`);
      continue;
    }
    const [relativePath] = target.split("#", 1);
    const decoded = decodeURIComponent(relativePath);
    const resolved = resolve(dirname(file), decoded);
    if (!existsSync(resolved) || (!statSync(resolved).isFile() && !statSync(resolved).isDirectory())) {
      failures.push(`${file}: missing local target ${target}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Documentation check passed (${files.length} Markdown files).`);
