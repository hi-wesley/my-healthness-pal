#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractCtxKeysFromFactory(filePath, factoryName) {
  const src = read(filePath);
  const re = new RegExp(
    `function\\s+${factoryName}\\s*\\(ctx\\)\\s*\\{[\\s\\S]*?const\\s*\\{([\\s\\S]*?)\\}\\s*=\\s*ctx;`,
    "m"
  );
  const match = src.match(re);
  if (!match) return [];
  return match[1]
    .split(/,\s*/)
    .map((s) => s.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .map((s) => s.split(/\s*:\s*/)[0].trim());
}

function extractPassedKeys(src, callName) {
  const re = new RegExp(`${callName}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "m");
  const match = src.match(re);
  if (!match) return [];
  return match[1]
    .split(/,\s*/)
    .map((s) => s.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .map((s) => s.split(/\s*:\s*/)[0].trim());
}

function diff(needed, passed) {
  return [...needed].filter((k) => !passed.has(k));
}

function run() {
  const uiPath = path.join(ROOT, "modules/ui.js");
  const focusPath = path.join(ROOT, "modules/ui/focus.js");
  const insightsPath = path.join(ROOT, "modules/ui/insightsView.js");
  const samplePath = path.join(ROOT, "modules/ui/sampleGenerator.js");

  const ui = read(uiPath);

  const focusNeeded = new Set(extractCtxKeysFromFactory(focusPath, "createFocusRenderer"));
  const focusPassed = new Set(extractPassedKeys(ui, "createFocusRenderer"));
  const insightsNeeded = new Set(extractCtxKeysFromFactory(insightsPath, "createInsightsView"));
  const insightsPassed = new Set(extractPassedKeys(ui, "createInsightsView"));
  const sampleNeeded = new Set(extractCtxKeysFromFactory(samplePath, "createSampleGenerator"));
  const samplePassed = new Set(extractPassedKeys(ui, "createSampleGenerator"));

  const focusMissing = diff(focusNeeded, focusPassed);
  const insightsMissing = diff(insightsNeeded, insightsPassed);
  const sampleMissing = diff(sampleNeeded, samplePassed);

  const hasErrors = focusMissing.length || insightsMissing.length || sampleMissing.length;

  if (focusMissing.length) {
    console.error("focus missing:", focusMissing);
  } else {
    console.log("focus missing: []");
  }

  if (insightsMissing.length) {
    console.error("insights missing:", insightsMissing);
  } else {
    console.log("insights missing: []");
  }

  if (sampleMissing.length) {
    console.error("sample missing:", sampleMissing);
  } else {
    console.log("sample missing: []");
  }

  process.exit(hasErrors ? 1 : 0);
}

run();
