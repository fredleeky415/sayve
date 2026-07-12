#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd();
const generator = join(cwd, "scripts", "generate-setup-env-examples.mjs");

const raw = execFileSync(process.execPath, [generator, "write"], {
  cwd,
  encoding: "utf8"
});
const result = JSON.parse(raw);
const outputDir = result.outputDir ?? "outputs/setup";
const files = Array.isArray(result.files) ? result.files : [];

const priority = [
  "private-beta-go-live-run-sheet.md",
  "live-deployment-execution-order.md",
  "live-rollout-sequence.md",
  "handoff.md",
  "execution-checklist.md",
  "env-map.md",
  "provider-setup.md"
];
const prioritized = priority.filter((name) => files.includes(name));

const lines = [
  "Sayve go-live pack generated.",
  `Output: ${outputDir}`,
  "",
  "Open these first:",
  ...prioritized.map((name, index) => `${index + 1}. ${outputDir}/${name}`),
  "",
  "After a live smoke run writes outputs/setup/deploy-proof-report.json:",
  "pnpm run report:deploy-proof"
];

process.stdout.write(`${lines.join("\n")}\n`);
