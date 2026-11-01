#!/usr/bin/env node
// Turns each folder under repos/ into a git repo with one baseline commit, tagged "baseline".
// Safe to re-run: use --reset to put every repo back to the baseline and remove .team/ leftovers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "repos");
const reset = process.argv.includes("--reset");
const git = (cwd, ...a) => spawnSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", ...a], { cwd, encoding: "utf8" });

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
