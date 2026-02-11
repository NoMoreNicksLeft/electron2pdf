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

const args = process.argv.slice(2);

const electronBinary = findElectronBinary();
if (!electronBinary) {
  process.stderr.write('Chromium runtime dependency not found (npm package: electron). Run: npm install\n');
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
