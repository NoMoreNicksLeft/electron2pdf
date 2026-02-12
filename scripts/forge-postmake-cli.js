const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} failed with exit code ${code}`));
    });
  });
}

function runCapture(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `${cmd} failed with exit code ${code}`));
    });
  });
}

async function exists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isSymbolicLink()) {
      const link = await fs.promises.readlink(s);
      await fs.promises.symlink(link, d);
    } else {
      await fs.promises.copyFile(s, d);
    }
  }
}

async function pruneLocales(libexecDir) {
  const localesDir = path.join(libexecDir, 'locales');
  if (!(await exists(localesDir))) return;
  const entries = await fs.promises.readdir(localesDir);
  for (const name of entries) {
    if (name === 'en-US.pak') continue;
    await fs.promises.rm(path.join(localesDir, name), { force: true });
  }
}

async function thinMacUniversalBinaries({ libexecDir, arch }) {
  // Only applicable on macOS builds where libexec contains Contents/...
  const contentsDir = path.join(libexecDir, 'Contents');
  if (!(await exists(contentsDir))) return;

  const archName = arch === 'x64' ? 'x86_64' : (arch === 'arm64' ? 'arm64' : null);
  if (!archName) return;

  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      // Heuristic: skip huge non-binaries by extension.
      if (/\.(pak|json|plist|txt|html|dat|bin)$/i.test(e.name)) continue;

      let isMach = false;
      try {
        const out = String(await runCapture('file', ['-b', p], process.cwd()));
        isMach = out.includes('Mach-O');
      } catch {
        continue;
      }
      if (!isMach) continue;

      try {
        const info = String(await runCapture('lipo', ['-info', p], process.cwd())).trim();
        if (!info.includes('are:') && !info.includes('architecture:')) continue;
        if (info.includes(`architecture: ${archName}`) && !info.includes('are:')) continue;
        const tmp = `${p}.thin`;
        await fs.promises.rm(tmp, { force: true });
        await run('lipo', ['-thin', archName, p, '-output', tmp], process.cwd());
        await fs.promises.rename(tmp, p);
      } catch {
        // Some Mach-O files may not be universal or thinnable; ignore.
      }
    }
  }

  await walk(contentsDir);
}

async function stripElfBinaries(libexecDir) {
  // Best-effort size reduction on Linux: strip debug symbols from ELF binaries.
  let hasStrip = false;
  try {
    await runCapture('sh', ['-lc', 'command -v strip >/dev/null 2>&1 && echo yes || echo no'], process.cwd());
    hasStrip = true;
  } catch {
    hasStrip = false;
  }
  if (!hasStrip) return;

  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;

      let isElf = false;
      try {
        const out = String(await runCapture('file', ['-b', p], process.cwd()));
        isElf = out.includes('ELF');
      } catch {
        continue;
      }
      if (!isElf) continue;

      try {
        await run('strip', ['--strip-unneeded', p], process.cwd());
      } catch {
        // Some binaries may be non-strippable; ignore.
      }
    }
  }

  await walk(libexecDir);
}

module.exports = async (forgeConfig, makeResults) => {
  const projectRoot = forgeConfig?.dir || process.cwd();
  const outDir = path.join(projectRoot, 'out');

  // Electron Forge passes makeResults, but we rely on the packaged directory in out/
  // because it includes the unpacked .app bundle we can transform into a libexec layout.

  const packagedDirs = [];
  try {
    const outEntries = await fs.promises.readdir(outDir, { withFileTypes: true });
    for (const e of outEntries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'make') continue;
      if (!e.name.startsWith('electron2pdf-')) continue;
      packagedDirs.push(path.join(outDir, e.name));
    }
  } catch {
    return;
  }

  const pkgJsonPath = path.join(projectRoot, 'package.json');
  const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf8'));
  const version = String(pkgJson.version || '0.0.0');

  const homebrewRoot = path.join(projectRoot, 'homebrew');
  await fs.promises.mkdir(homebrewRoot, { recursive: true });

  const distRoot = path.join(projectRoot, 'dist');
  await fs.promises.mkdir(distRoot, { recursive: true });

  for (const pkgDir of packagedDirs) {
    const baseName = path.basename(pkgDir); // e.g. electron2pdf-darwin-x64
    const parts = baseName.split('-');
    const platform = parts[1] || 'unknown';
    const arch = parts[2] || 'unknown';

    const distPlatform = platform === 'darwin' ? 'macos' : platform;

    const targetRoot = path.join(homebrewRoot, `${distPlatform}-${arch}`);
    const hbBinDir = path.join(targetRoot, 'bin');
    const hbLibexecDir = path.join(targetRoot, 'libexec');

    await fs.promises.rm(targetRoot, { recursive: true, force: true });
    await fs.promises.mkdir(hbBinDir, { recursive: true });
    await fs.promises.mkdir(hbLibexecDir, { recursive: true });

    // macOS packaged output is an .app. We copy its Contents/ into libexec/Contents/.
    const appBundle = path.join(pkgDir, 'electron2pdf.app');
    if (await exists(appBundle)) {
      const srcContents = path.join(appBundle, 'Contents');
      await fs.promises.access(srcContents);
      const destContents = path.join(hbLibexecDir, 'Contents');
      await copyDir(srcContents, destContents);
    } else {
      // Linux/Windows packaged output doesn't use .app. We try a "resources/app.asar" style layout.
      // We keep whatever Forge produced, under libexec/.
      await copyDir(pkgDir, hbLibexecDir);
    }

    await pruneLocales(hbLibexecDir);
    if (distPlatform === 'macos') {
      await thinMacUniversalBinaries({ libexecDir: hbLibexecDir, arch });
    } else if (distPlatform === 'linux') {
      await stripElfBinaries(hbLibexecDir);
    }

    const wrapperPath = path.join(hbBinDir, 'electron2pdf');
    const wrapper = `#!/usr/bin/env bash\nset -euo pipefail\n\nresolve_path() {\n  local p=\"$1\"\n  if command -v python3 >/dev/null 2>&1; then\n    python3 - <<'PY' \"$p\"\nimport os,sys\nprint(os.path.realpath(sys.argv[1]))\nPY\n    return\n  fi\n  perl -MCwd -e 'print Cwd::realpath($ARGV[0])' \"$p\"\n}\n\nSELF=\"$(resolve_path \"$0\")\"\nBINDIR=\"$(dirname \"$SELF\")\"\nPREFIX=\"$(cd \"$BINDIR/..\" && pwd)\"\n\n# macOS-style libexec layout (Contents/...)\nif [ -x \"$PREFIX/libexec/Contents/MacOS/electron2pdf\" ]; then\n  exec \"$PREFIX/libexec/Contents/MacOS/electron2pdf\" \"$@\"\nfi\n\n# Linux-style libexec layout (electron binary + resources)\nif [ -x \"$PREFIX/libexec/electron2pdf\" ]; then\n  exec \"$PREFIX/libexec/electron2pdf\" \"$@\"\nfi\n\necho \"electron2pdf: could not locate libexec runtime under $PREFIX/libexec\" >&2\nexit 1\n`;
    await fs.promises.writeFile(wrapperPath, wrapper, { mode: 0o755 });
    await fs.promises.chmod(wrapperPath, 0o755);

    const tarName = `electron2pdf-${version}-${distPlatform}-${arch}.tar.gz`;
    const tarPath = path.join(distRoot, tarName);
    await fs.promises.rm(tarPath, { force: true });
    await run('tar', ['-czf', tarPath, 'bin', 'libexec'], targetRoot);

    const shaPath = `${tarPath}.sha256`;
    await fs.promises.rm(shaPath, { force: true });
    const shaLine = (await runCapture('shasum', ['-a', '256', tarPath], distRoot)).trim();
    const sha = shaLine.split(/\s+/)[0] || '';
    await fs.promises.writeFile(shaPath, `${sha}\n`, 'utf8');
  }
};
