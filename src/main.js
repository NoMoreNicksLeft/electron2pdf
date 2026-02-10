const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function usageAndExit(exitCode) {
  // No additional comments per project style; keep output minimal.
  process.stderr.write('Usage: electron2pdf [options] <url> <output.pdf>\n');
  process.exit(exitCode);
}

function parseViewportSize(value) {
  const m = /^\s*(\d+)\s*[xX]\s*(\d+)\s*$/.exec(String(value));
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

function unitRealToInches(value) {
  const s = String(value).trim();
  const m = /^(-?\d+(?:\.\d+)?)(px|mm|cm|in)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'mm').toLowerCase();

  if (!Number.isFinite(n)) return null;
  if (unit === 'in') return n;
  if (unit === 'cm') return n / 2.54;
  if (unit === 'mm') return n / 25.4;
  if (unit === 'px') return n / 96;
  return null;
}

function normalizeInputToUrl(input) {
  const s = String(input);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  const abs = path.resolve(process.cwd(), s);
  return `file://${abs}`;
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    usageAndExit(args.length === 0 ? 2 : 0);
  }

  const options = {
    customHeaders: [],
    cookies: [],
    allow: [],
    bypassProxyFor: [],
    post: [],
    postFile: [],
    runScript: [],
    replace: [],
    proxy: undefined,
    quiet: false,
    logLevel: 'info',
    javascriptEnabled: true,
    javascriptDelayMs: 200,
    windowStatus: undefined,
    viewportSize: undefined,
    zoomFactor: 1,
    printMediaType: false,
    background: true,
    orientation: 'Portrait',
    pageSize: undefined,
    pageWidthIn: undefined,
    pageHeightIn: undefined,
    marginTopIn: undefined,
    marginBottomIn: undefined,
    marginLeftIn: undefined,
    marginRightIn: undefined,
    userStyleSheet: undefined,
  };

  const positionals = [];

  function popValue(i) {
    if (i + 1 >= args.length) usageAndExit(2);
    return args[i + 1];
  }

  function popTwoValues(i) {
    if (i + 2 >= args.length) usageAndExit(2);
    return [args[i + 1], args[i + 2]];
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (!String(a).startsWith('-')) {
      positionals.push(a);
      continue;
    }

    if (a === '-h' || a === '--help') {
      usageAndExit(0);
    }

    if (a === '-q' || a === '--quiet') {
      options.quiet = true;
      options.logLevel = 'none';
      continue;
    }

    if (a === '--log-level') {
      options.logLevel = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--background') {
      options.background = true;
      continue;
    }

    if (a === '--no-background') {
      options.background = false;
      continue;
    }

    if (a === '--print-media-type') {
      options.printMediaType = true;
      continue;
    }

    if (a === '--no-print-media-type') {
      options.printMediaType = false;
      continue;
    }

    if (a === '-O' || a === '--orientation') {
      const v = String(popValue(i));
      if (v !== 'Portrait' && v !== 'Landscape') usageAndExit(2);
      options.orientation = v;
      i++;
      continue;
    }

    if (a === '-s' || a === '--page-size') {
      options.pageSize = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--page-width') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.pageWidthIn = inches;
      i++;
      continue;
    }

    if (a === '--page-height') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.pageHeightIn = inches;
      i++;
      continue;
    }

    if (a === '-T' || a === '--margin-top') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.marginTopIn = inches;
      i++;
      continue;
    }

    if (a === '-B' || a === '--margin-bottom') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.marginBottomIn = inches;
      i++;
      continue;
    }

    if (a === '-L' || a === '--margin-left') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.marginLeftIn = inches;
      i++;
      continue;
    }

    if (a === '-R' || a === '--margin-right') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) usageAndExit(2);
      options.marginRightIn = inches;
      i++;
      continue;
    }

    if (a === '--viewport-size') {
      const v = parseViewportSize(popValue(i));
      if (!v) usageAndExit(2);
      options.viewportSize = v;
      i++;
      continue;
    }

    if (a === '--zoom') {
      const z = Number(popValue(i));
      if (!Number.isFinite(z) || z <= 0) usageAndExit(2);
      options.zoomFactor = z;
      i++;
      continue;
    }

    if (a === '-n' || a === '--disable-javascript') {
      options.javascriptEnabled = false;
      continue;
    }

    if (a === '--enable-javascript') {
      options.javascriptEnabled = true;
      continue;
    }

    if (a === '--javascript-delay') {
      const ms = Number(popValue(i));
      if (!Number.isFinite(ms) || ms < 0) usageAndExit(2);
      options.javascriptDelayMs = ms;
      i++;
      continue;
    }

    if (a === '--window-status') {
      options.windowStatus = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--user-style-sheet') {
      options.userStyleSheet = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--custom-header') {
      const [name, value] = popTwoValues(i);
      options.customHeaders.push({ name: String(name), value: String(value) });
      i += 2;
      continue;
    }

    if (a === '--cookie') {
      const [name, value] = popTwoValues(i);
      options.cookies.push({ name: String(name), value: String(value) });
      i += 2;
      continue;
    }

    if (a === '-p' || a === '--proxy') {
      options.proxy = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--allow') {
      options.allow.push(String(popValue(i)));
      i++;
      continue;
    }

    if (a === '--bypass-proxy-for') {
      options.bypassProxyFor.push(String(popValue(i)));
      i++;
      continue;
    }

    if (a === '--post') {
      const [name, value] = popTwoValues(i);
      options.post.push({ name: String(name), value: String(value) });
      i += 2;
      continue;
    }

    if (a === '--post-file') {
      const [name, value] = popTwoValues(i);
      options.postFile.push({ name: String(name), path: String(value) });
      i += 2;
      continue;
    }

    if (a === '--run-script') {
      options.runScript.push(String(popValue(i)));
      i++;
      continue;
    }

    if (a === '--replace') {
      const [name, value] = popTwoValues(i);
      options.replace.push({ name: String(name), value: String(value) });
      i += 2;
      continue;
    }

    if (
      a === '--collate' ||
      a === '--no-collate' ||
      a === '--cookie-jar' ||
      a === '--copies' ||
      a === '-d' ||
      a === '--dpi' ||
      a === '-g' ||
      a === '--grayscale' ||
      a === '-l' ||
      a === '--lowquality' ||
      a === '--image-dpi' ||
      a === '--image-quality' ||
      a === '--no-pdf-compression' ||
      a === '--title' ||
      a === '--use-xserver' ||
      a === '--extended-help' ||
      a === '--htmldoc' ||
      a === '--license' ||
      a === '--manpage' ||
      a === '--read-args-from-stdin' ||
      a === '--readme' ||
      a === '-V' ||
      a === '--version' ||
      a === '--dump-default-toc-xsl' ||
      a === '--dump-outline' ||
      a === '--outline' ||
      a === '--no-outline' ||
      a === '--outline-depth' ||
      a === '--cache-dir' ||
      a === '--checkbox-checked-svg' ||
      a === '--checkbox-svg' ||
      a === '--custom-header-propagation' ||
      a === '--no-custom-header-propagation' ||
      a === '--debug-javascript' ||
      a === '--no-debug-javascript' ||
      a === '--default-header' ||
      a === '--encoding' ||
      a === '--disable-external-links' ||
      a === '--enable-external-links' ||
      a === '--disable-forms' ||
      a === '--enable-forms' ||
      a === '--images' ||
      a === '--no-images' ||
      a === '--disable-internal-links' ||
      a === '--enable-internal-links' ||
      a === '--keep-relative-links' ||
      a === '--load-error-handling' ||
      a === '--load-media-error-handling' ||
      a === '--disable-local-file-access' ||
      a === '--enable-local-file-access' ||
      a === '--minimum-font-size' ||
      a === '--exclude-from-outline' ||
      a === '--include-in-outline' ||
      a === '--page-offset' ||
      a === '--password' ||
      a === '--disable-plugins' ||
      a === '--enable-plugins' ||
      a === '--proxy-hostname-lookup' ||
      a === '--radiobutton-checked-svg' ||
      a === '--radiobutton-svg' ||
      a === '--resolve-relative-links' ||
      a === '--disable-smart-shrinking' ||
      a === '--enable-smart-shrinking' ||
      a === '--ssl-crt-path' ||
      a === '--ssl-key-password' ||
      a === '--ssl-key-path' ||
      a === '--stop-slow-scripts' ||
      a === '--no-stop-slow-scripts' ||
      a === '--disable-toc-back-links' ||
      a === '--enable-toc-back-links' ||
      a === '--username' ||
      a === '--footer-center' ||
      a === '--footer-font-name' ||
      a === '--footer-font-size' ||
      a === '--footer-html' ||
      a === '--footer-left' ||
      a === '--footer-line' ||
      a === '--no-footer-line' ||
      a === '--footer-right' ||
      a === '--footer-spacing' ||
      a === '--header-center' ||
      a === '--header-font-name' ||
      a === '--header-font-size' ||
      a === '--header-html' ||
      a === '--header-left' ||
      a === '--header-line' ||
      a === '--no-header-line' ||
      a === '--header-right' ||
      a === '--header-spacing' ||
      a === '--disable-dotted-lines' ||
      a === '--toc-header-text' ||
      a === '--toc-level-indentation' ||
      a === '--disable-toc-links' ||
      a === '--toc-text-size-shrink' ||
      a === '--xsl-style-sheet'
    ) {
      if (
        a === '--cookie-jar' ||
        a === '--copies' ||
        a === '--dpi' ||
        a === '-d' ||
        a === '--image-dpi' ||
        a === '--image-quality' ||
        a === '--title' ||
        a === '--dump-outline' ||
        a === '--outline-depth' ||
        a === '--cache-dir' ||
        a === '--checkbox-checked-svg' ||
        a === '--checkbox-svg' ||
        a === '--encoding' ||
        a === '--load-error-handling' ||
        a === '--load-media-error-handling' ||
        a === '--minimum-font-size' ||
        a === '--page-offset' ||
        a === '--password' ||
        a === '--ssl-crt-path' ||
        a === '--ssl-key-password' ||
        a === '--ssl-key-path' ||
        a === '--username' ||
        a === '--footer-center' ||
        a === '--footer-font-name' ||
        a === '--footer-font-size' ||
        a === '--footer-html' ||
        a === '--footer-left' ||
        a === '--footer-right' ||
        a === '--footer-spacing' ||
        a === '--header-center' ||
        a === '--header-font-name' ||
        a === '--header-font-size' ||
        a === '--header-html' ||
        a === '--header-left' ||
        a === '--header-right' ||
        a === '--header-spacing' ||
        a === '--toc-header-text' ||
        a === '--toc-level-indentation' ||
        a === '--toc-text-size-shrink' ||
        a === '--xsl-style-sheet'
      ) {
        i++;
      }
      continue;
    }

    usageAndExit(2);
  }

  if (positionals.length < 2) {
    usageAndExit(2);
  }

  const url = positionals[0];
  const outputFile = positionals[1];

  return { url, outputFile, options };
}

async function waitForWindowStatus(win, expected, timeoutMs) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const status = await win.webContents.executeJavaScript('window.status', true);
    if (String(status) === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function renderToPdf({ url, outputFile, options }) {
  const viewport = options.viewportSize || { width: 1280, height: 720 };

  const win = new BrowserWindow({
    show: false,
    width: viewport.width,
    height: viewport.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: !!options.javascriptEnabled,
    },
  });

  const targetUrl = normalizeInputToUrl(url);

  if (options.customHeaders.length > 0) {
    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      for (const h of options.customHeaders) {
        requestHeaders[h.name] = h.value;
      }
      callback({ requestHeaders });
    });
  }

  if (options.cookies.length > 0) {
    for (const c of options.cookies) {
      try {
        await win.webContents.session.cookies.set({ url: targetUrl, name: c.name, value: c.value });
      } catch {
      }
    }
  }

  await win.loadURL(targetUrl);

  if (options.userStyleSheet) {
    const cssPath = path.resolve(process.cwd(), options.userStyleSheet);
    const css = await fs.promises.readFile(cssPath, 'utf8');
    await win.webContents.insertCSS(css);
  }

  if (options.zoomFactor && options.zoomFactor !== 1) {
    win.webContents.setZoomFactor(options.zoomFactor);
  }

  if (options.windowStatus) {
    await waitForWindowStatus(win, options.windowStatus, 30000);
  }

  if (options.javascriptDelayMs && options.javascriptDelayMs > 0) {
    await new Promise((r) => setTimeout(r, options.javascriptDelayMs));
  }

  const printOptions = {
    printBackground: !!options.background,
    preferCSSPageSize: true,
    landscape: options.orientation === 'Landscape',
  };

  if (options.pageWidthIn != null && options.pageHeightIn != null) {
    printOptions.pageSize = { width: options.pageWidthIn, height: options.pageHeightIn };
    printOptions.preferCSSPageSize = false;
  } else if (options.pageSize) {
    printOptions.pageSize = options.pageSize;
    printOptions.preferCSSPageSize = false;
  }

  if (
    options.marginTopIn != null ||
    options.marginBottomIn != null ||
    options.marginLeftIn != null ||
    options.marginRightIn != null
  ) {
    printOptions.margins = {
      top: options.marginTopIn || 0,
      bottom: options.marginBottomIn || 0,
      left: options.marginLeftIn || 0,
      right: options.marginRightIn || 0,
    };
  }

  const pdfBuffer = await win.webContents.printToPDF(printOptions);

  const outPath = path.resolve(process.cwd(), outputFile);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, pdfBuffer);

  win.close();
}

(async () => {
  const { url, outputFile, options } = parseArgs(process.argv);

  if (options.proxy) {
    app.commandLine.appendSwitch('proxy-server', options.proxy);
  }

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  try {
    await app.whenReady();
    await renderToPdf({ url, outputFile, options });
    process.exit(0);
  } catch (err) {
    process.stderr.write((err && err.stack) ? `${err.stack}\n` : `${String(err)}\n`);
    process.exit(1);
  }
})();
