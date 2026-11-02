#!/usr/bin/env node
// Turns each folder under repos/ into a git repo with one baseline commit, tagged "baseline".
// Safe to re-run: use --reset to put every repo back to the baseline and remove .team/ leftovers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "repos");
fs.mkdirSync(root, { recursive: true });
const reseed = process.argv.includes("--reseed"); // wipe repos/ and rebuild it from seed/ (after a kit update that changed the sample code)
const reset = process.argv.includes("--reset") || reseed;
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", ...a], { cwd, encoding: "utf8" });

// A fresh clone has no repos/ folder: copy the sources from seed/ first (seed/ is tracked by the kit, repos/ is not).
const seed = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed");
if (fs.existsSync(seed)) {
  for (const name of fs.readdirSync(seed)) {
    const target = path.join(root, name);
    if (reseed && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (!fs.existsSync(target)) {
      fs.cpSync(path.join(seed, name), target, { recursive: true });
      console.log(`${name}: copied from seed/`);
    }
  }
}

for (const name of fs.readdirSync(root)) {
  const dir = path.join(root, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (!fs.existsSync(path.join(dir, ".git"))) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "baseline");
    git(dir, "tag", "baseline");
    console.log(`${name}: created baseline commit`);
  } else if (reset) {
    git(dir, "checkout", "-q", "main");
    git(dir, "reset", "-q", "--hard", "baseline");
    git(dir, "clean", "-fdq");
    for (const b of git(dir, "branch", "--format=%(refname:short)").stdout.split("\n").filter((b) => b && b !== "main")) git(dir, "branch", "-D", b);
    console.log(`${name}: reset to baseline`);
  } else {
    console.log(`${name}: already a git repo (use --reset to return to baseline)`);
  }
}
