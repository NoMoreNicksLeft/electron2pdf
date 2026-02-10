const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function usageAndExit(exitCode) {
  // No additional comments per project style; keep output minimal.
  process.stderr.write('Usage: electron2pdf <url> <output.pdf>\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    usageAndExit(args.length === 0 ? 2 : 0);
  }

  if (args.length < 2) {
    usageAndExit(2);
  }

  const url = args[0];
  const outputFile = args[1];

  return { url, outputFile };
}

async function renderToPdf({ url, outputFile }) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL(url);

  const pdfBuffer = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
  });

  const outPath = path.resolve(process.cwd(), outputFile);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, pdfBuffer);

  win.close();
}

(async () => {
  const { url, outputFile } = parseArgs(process.argv);

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  try {
    await app.whenReady();
    await renderToPdf({ url, outputFile });
    process.exit(0);
  } catch (err) {
    process.stderr.write((err && err.stack) ? `${err.stack}\n` : `${String(err)}\n`);
    process.exit(1);
  }
})();
