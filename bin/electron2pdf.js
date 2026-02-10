#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

function findElectronBinary() {
  try {
    return require('electron');
  } catch {
    return null;
  }
}

function usageAndExit(exitCode) {
  process.stderr.write('Usage: electron2pdf <url> <output.pdf>\n');
  process.exit(exitCode);
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  usageAndExit(args.length === 0 ? 2 : 0);
}

const electronBinary = findElectronBinary();
if (!electronBinary) {
  process.stderr.write('electron dependency not found. Run: npm install\n');
  process.exit(1);
}

const mainPath = path.resolve(__dirname, '..', 'src', 'main.js');

const child = spawn(electronBinary, [mainPath, ...args], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code == null ? 1 : code);
});
