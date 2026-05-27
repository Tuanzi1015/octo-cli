#!/usr/bin/env node
"use strict";

// postinstall: download the prebuilt octo binary that matches this package
// version and the host platform from the GitHub Release, verify its checksum,
// and extract it into ../bin. Mirrors goreleaser's archive naming
// (octo_<version>_<os>_<arch>.tar.gz, .zip on Windows; os/arch lowercase).

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = "Mininglamp-OSS/octo-cli";
const VERSION = require("../package.json").version;

const OS = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
const ARCH = { x64: "amd64", arm64: "arm64" }[process.arch];
const isWin = process.platform === "win32";

function fail(msg) {
  console.error(`\n[octo] install failed: ${msg}`);
  console.error(`[octo] Grab a binary manually from https://github.com/${REPO}/releases\n`);
  process.exit(1);
}

// GET with redirect following (GitHub release assets 302 to a CDN).
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too many redirects"));
      return;
    }
    https
      .get(url, { headers: { "User-Agent": "octo-npm-installer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(download(res.headers.location, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function main() {
  if (!OS || !ARCH) fail(`unsupported platform ${process.platform}/${process.arch}`);
  if (!VERSION || VERSION === "0.0.0") {
    fail("package version is a placeholder (0.0.0); this package must be published with a real release version");
  }

  const ext = isWin ? "zip" : "tar.gz";
  const asset = `octo_${VERSION}_${OS}_${ARCH}.${ext}`;
  const base = `https://github.com/${REPO}/releases/download/v${VERSION}`;
  const binName = isWin ? "octo.exe" : "octo";
  const binDir = path.join(__dirname, "..", "bin");

  console.log(`[octo] downloading ${asset} ...`);
  let archive, sums;
  try {
    archive = await download(`${base}/${asset}`);
    sums = (await download(`${base}/checksums.txt`)).toString("utf8");
  } catch (e) {
    fail(e.message);
  }

  // Verify sha256 against checksums.txt ("<sha256>  <filename>" per line).
  const entry = sums
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((p) => p[1] === asset);
  if (!entry) fail(`no checksum entry for ${asset}`);
  const got = crypto.createHash("sha256").update(archive).digest("hex");
  if (got !== entry[0]) fail(`checksum mismatch for ${asset} (want ${entry[0]}, got ${got})`);

  // Extract just the binary into bin/. bsdtar (macOS/Windows) and GNU tar
  // (Linux) both handle the formats we ship (.tar.gz via -xzf, .zip via -xf).
  fs.mkdirSync(binDir, { recursive: true });
  const tmp = path.join(binDir, asset);
  fs.writeFileSync(tmp, archive);
  try {
    const args = isWin ? ["-xf", tmp, "-C", binDir, binName] : ["-xzf", tmp, "-C", binDir, binName];
    execFileSync("tar", args, { stdio: "inherit" });
    fs.chmodSync(path.join(binDir, binName), 0o755);
  } catch (e) {
    fail(`extract failed: ${e.message}`);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }

  console.log(`[octo] installed octo ${VERSION} (${OS}/${ARCH})`);
}

main();
