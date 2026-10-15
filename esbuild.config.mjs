// Bundles src/main.js (and math.js) into the main.js Obsidian loads.
// usage: node esbuild.config.mjs [--watch]
import { build, context } from "esbuild";

const notice = `/*
 * Tahoe Math — https://github.com/krishnanefx/obsidian-tahoe-math (MIT).
 * Built from src/; edit the sources, not this file.
 *
 * Includes math.js — https://github.com/josdejong/mathjs
 * Copyright (C) 2013-2026 Jos de Jong. Licensed under the Apache License,
 * Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).
 */`;

const options = {
  entryPoints: ["src/main.js"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  minify: true,
  legalComments: "eof",
  logLevel: "warning",
  banner: { js: notice },
};

if (process.argv.includes("--watch")) {
  await (await context(options)).watch();
} else {
  await build(options);
  console.log("built main.js");
}
