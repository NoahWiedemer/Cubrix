// Bumps the version in package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml
// (+ Cargo.lock), commits and tags vX.Y.Z.  Usage: node scripts/release.mjs patch|minor|major
import { execSync } from "node:child_process";
import fs from "node:fs";

const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind)) {
  console.error("Aufruf: npm run release:patch | release:minor | release:major");
  process.exit(1);
}
const sh = (cmd) => execSync(cmd, { stdio: "pipe" }).toString().trim();
if (sh("git status --porcelain")) {
  console.error("Bitte zuerst alle Änderungen committen.");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const [maj, min, pat] = pkg.version.split(".").map(Number);
const next = kind === "major" ? `${maj + 1}.0.0` : kind === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;

pkg.version = next;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = next;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
fs.writeFileSync(cargoPath, fs.readFileSync(cargoPath, "utf8").replace(/^version = ".*"$/m, `version = "${next}"`));
const lockPath = "src-tauri/Cargo.lock";
if (fs.existsSync(lockPath))
  fs.writeFileSync(
    lockPath,
    fs.readFileSync(lockPath, "utf8").replace(/(name = "modelonio"\nversion = ")[^"]+(")/, `$1${next}$2`),
  );

sh("npm install --package-lock-only --ignore-scripts");
sh(`git add package.json package-lock.json ${confPath} ${cargoPath} ${lockPath}`);
sh(`git commit -m "Cubrix v${next}"`);
sh(`git tag -a v${next} -m "Cubrix v${next}"`);
console.log(`Version ${next} committet und als v${next} getaggt.\nVeröffentlichen mit:\n  git push && git push origin v${next}`);
