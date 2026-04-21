import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function readArg(name) {
  const index = process.argv.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function normalizeVersion(input) {
  if (!input) {
    return "";
  }

  return input.startsWith("v") ? input.slice(1) : input;
}

function assertCondition(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  const version = normalizeVersion(readArg("--version"));
  const errors = [];

  assertCondition(Boolean(version), "Missing required `--version` argument.", errors);
  assertCondition(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), `Release version \`${version || "<empty>"}\` is not a supported semver value.`, errors);
  if (errors.length > 0) {
    for (const message of errors) {
      console.error(message);
    }
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const packageJsonPaths = [
    "package.json",
    "apps/api/package.json",
    "apps/bot/package.json",
    "apps/host-daemon/package.json",
    "apps/miniapp/package.json",
    "apps/worker/package.json",
    "packages/approval-engine/package.json",
    "packages/bootstrap/package.json",
    "packages/hooks/package.json",
    "packages/policy-engine/package.json",
    "packages/protocol/package.json",
    "packages/repo-proof/package.json",
    "packages/runtime-adapters/package.json",
    "packages/session-engine/package.json",
    "packages/shared/package.json",
    "packages/telegram-kit/package.json"
  ];
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const releaseNotesPath = path.join(repoRoot, "docs", "releases", `${version}.md`);

  const packageJsons = await Promise.all(packageJsonPaths.map(async (relativePath) => ({
    relativePath,
    data: await readJson(path.join(repoRoot, relativePath))
  })));
  const changelog = await readFile(changelogPath, "utf8");
  const releaseNotes = await readFile(releaseNotesPath, "utf8");

  for (const { relativePath, data } of packageJsons) {
    assertCondition(data.version === version, `${relativePath} has version \`${data.version}\`, expected \`${version}\`.`, errors);
  }

  assertCondition(
    changelog.includes(`## v${version}`),
    `CHANGELOG.md is missing a \`## v${version}\` section.`,
    errors
  );
  assertCondition(
    releaseNotes.includes(`# HappyTG ${version}`),
    `docs/releases/${version}.md is missing the expected \`# HappyTG ${version}\` heading.`,
    errors
  );
  assertCondition(
    releaseNotes.includes(`- \`${version}\``),
    `docs/releases/${version}.md is missing the expected release version bullet.`,
    errors
  );

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(message);
    }
    process.exit(1);
  }

  console.log(`Release validation passed for ${version}.`);
  console.log(`Checked ${packageJsonPaths.length} package versions, CHANGELOG.md, and docs/releases/${version}.md.`);
}

await main();
