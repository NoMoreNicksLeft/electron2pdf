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

module.exports = async (forgeConfig, makeResults) => {
  const projectRoot = forgeConfig?.dir || process.cwd();
  const outDir = path.join(projectRoot, 'out');

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

  const cliOutRoot = path.join(outDir, 'cli');
  await fs.promises.mkdir(cliOutRoot, { recursive: true });

  for (const pkgDir of packagedDirs) {
    const baseName = path.basename(pkgDir);
    const cliDir = path.join(cliOutRoot, baseName);
    await fs.promises.rm(cliDir, { recursive: true, force: true });
    await fs.promises.mkdir(cliDir, { recursive: true });

    const appBundle = path.join(pkgDir, 'electron2pdf.app');
    await fs.promises.access(appBundle);

    const destBundle = path.join(cliDir, 'electron2pdf.app');
    await copyDir(appBundle, destBundle);

    const launcherPath = path.join(cliDir, 'electron2pdf');
    const launcher = `#!/bin/sh\nDIR=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\"\nexec \"$DIR/electron2pdf.app/Contents/MacOS/electron2pdf\" \"$@\"\n`;
    await fs.promises.writeFile(launcherPath, launcher, { mode: 0o755 });
    await fs.promises.chmod(launcherPath, 0o755);

    const makeDir = path.join(outDir, 'make');
    await fs.promises.mkdir(makeDir, { recursive: true });
    const zipName = `electron2pdf-cli-${baseName}.zip`;
    const zipPath = path.join(makeDir, zipName);
    await fs.promises.rm(zipPath, { force: true });
    await run('zip', ['-r', zipPath, path.basename(cliDir)], cliOutRoot);
  }
};
