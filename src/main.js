const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function helpAndExit(exitCode) {
  const out = exitCode === 0 ? process.stdout : process.stderr;
  out.write('Name:\n');
  out.write('  electron2pdf\n\n');
  out.write('Synopsis:\n');
  out.write('  electron2pdf [GLOBAL OPTION]... <input url/file name>... <output file>\n\n');
  out.write('Description:\n');
  out.write('  Renders a webpage or local HTML file to a PDF document using Electron.\n\n');
  out.write('Global Options:\n');
  out.write('  -h, --help                          Display help\n');
  out.write('  -q, --quiet                         Same as using --log-level none\n');
  out.write('      --log-level <level>             none, error, warn, info (default info)\n');
  out.write('  -O, --orientation <orientation>     Landscape or Portrait (default Portrait)\n');
  out.write('  -s, --page-size <Size>              A4, Letter, etc. (default uses CSS page size)\n');
  out.write('  -T, --margin-top <unitreal>         Top margin (e.g. 10mm, 1cm, 0.5in)\n');
  out.write('  -B, --margin-bottom <unitreal>      Bottom margin\n');
  out.write('  -L, --margin-left <unitreal>        Left margin\n');
  out.write('  -R, --margin-right <unitreal>       Right margin\n');
  out.write('      --page-width <unitreal>         Custom page width\n');
  out.write('      --page-height <unitreal>        Custom page height\n');
  out.write('      --background                    Print background (default)\n');
  out.write('      --no-background                 Do not print background\n');
  out.write('      --viewport-size <WxH>           Set viewport size (e.g. 1280x720)\n');
  out.write('      --zoom <float>                  Zoom factor (default 1)\n');
  out.write('  -n, --disable-javascript            Disable JavaScript\n');
  out.write('      --enable-javascript             Enable JavaScript (default)\n');
  out.write('      --javascript-delay <msec>       Wait after load (default 200)\n');
  out.write('      --window-status <string>        Wait until window.status equals value\n');
  out.write('      --run-script <path>             Execute JavaScript from file (repeatable)\n');
  out.write('      --custom-header <name> <value>  Add HTTP header (repeatable)\n');
  out.write('      --cookie <name> <value>         Set a cookie for the main URL (repeatable)\n');
  out.write('  -p, --proxy <proxy>                 Use a proxy (passed to Chromium)\n');
  out.write('      --user-style-sheet <path>       Inject CSS from file\n');
  out.write('      --print-media-type              Accepted for compatibility (no-op)\n');
  out.write('      --no-print-media-type           Accepted for compatibility (no-op)\n\n');
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
    helpAndExit(args.length === 0 ? 2 : 0);
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
    if (i + 1 >= args.length) helpAndExit(2);
    return args[i + 1];
  }

  function popTwoValues(i) {
    if (i + 2 >= args.length) helpAndExit(2);
    return [args[i + 1], args[i + 2]];
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (!String(a).startsWith('-')) {
      positionals.push(a);
      continue;
    }

    if (a === '-h' || a === '--help') {
      helpAndExit(0);
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
      if (v !== 'Portrait' && v !== 'Landscape') helpAndExit(2);
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
      if (inches == null) helpAndExit(2);
      options.pageWidthIn = inches;
      i++;
      continue;
    }

    if (a === '--page-height') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) helpAndExit(2);
      options.pageHeightIn = inches;
      i++;
      continue;
    }

    if (a === '-T' || a === '--margin-top') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) helpAndExit(2);
      options.marginTopIn = inches;
      i++;
      continue;
    }

    if (a === '-B' || a === '--margin-bottom') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) helpAndExit(2);
      options.marginBottomIn = inches;
      i++;
      continue;
    }

    if (a === '-L' || a === '--margin-left') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) helpAndExit(2);
      options.marginLeftIn = inches;
      i++;
      continue;
    }

    if (a === '-R' || a === '--margin-right') {
      const inches = unitRealToInches(popValue(i));
      if (inches == null) helpAndExit(2);
      options.marginRightIn = inches;
      i++;
      continue;
    }

    if (a === '--viewport-size') {
      const v = parseViewportSize(popValue(i));
      if (!v) helpAndExit(2);
      options.viewportSize = v;
      i++;
      continue;
    }

    if (a === '--zoom') {
      const z = Number(popValue(i));
      if (!Number.isFinite(z) || z <= 0) helpAndExit(2);
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
      if (!Number.isFinite(ms) || ms < 0) helpAndExit(2);
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
      a === '--post' ||
      a === '--post-file' ||
      a === '--print-media-type' ||
      a === '--no-print-media-type' ||
      a === '-p' ||
      a === '--resolve-relative-links' ||
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

    helpAndExit(2);
  }

  if (positionals.length < 2) {
    helpAndExit(2);
  }

  const outputFile = positionals[positionals.length - 1];
  const inputs = positionals.slice(0, -1);

  return { inputs, outputFile, options };
}

async function waitForWindowStatus(win, expected, timeoutMs) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const status = await win.webContents.executeJavaScript('window.status', true);
    if (String(status) === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function applyPrintMediaType(win) {
  const js = `(() => {
    try {
      const MEDIA_RULE = 4;
      const cssTexts = [];
      const linkMediaToAll = [];
      const includePrint = (mediaText) => {
        if (!mediaText) return false;
        return String(mediaText)
          .split(',')
          .some((p) => p.trim().toLowerCase() === 'print');
      };

      for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
        try {
          const media = node.getAttribute && node.getAttribute('media');
          if (media && includePrint(media)) {
            linkMediaToAll.push(true);
            node.setAttribute('media', 'all');
          }
        } catch (e) {
        }
      }

      for (const sheet of Array.from(document.styleSheets || [])) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (e) {
          continue;
        }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          try {
            if (rule && rule.type === MEDIA_RULE && includePrint(rule.media && rule.media.mediaText)) {
              for (const inner of Array.from(rule.cssRules || [])) {
                if (inner && inner.cssText) cssTexts.push(inner.cssText);
              }
            }
          } catch (e) {
          }
        }
      }

      return { ok: true, cssTexts, linkChanges: linkMediaToAll.length };
    } catch (e) {
      return { ok: false, error: String(e && (e.stack || e.message || e)) };
    }
  })();`;

  const result = await win.webContents.executeJavaScript(js, true);
  if (result && result.ok === false) throw new Error(result.error || 'Failed to collect print media CSS');
  if (result && Array.isArray(result.cssTexts) && result.cssTexts.length > 0) {
    await win.webContents.insertCSS(result.cssTexts.join('\n'));
  }
}

async function renderSingleToPdfBuffer({ input, options }) {
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

  const targetUrl = normalizeInputToUrl(input);

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

  if (options.printMediaType) {
    await applyPrintMediaType(win);
  }

  for (const scriptPath of options.runScript) {
    const abs = path.resolve(process.cwd(), scriptPath);
    const js = await fs.promises.readFile(abs, 'utf8');
    await win.webContents.executeJavaScript(js, true);
  }

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
  win.close();

  return pdfBuffer;
}

async function mergePdfBuffers(buffers) {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return Buffer.from(await merged.save());
}

(async () => {
  const { inputs, outputFile, options } = parseArgs(process.argv);

  if (options.proxy) {
    app.commandLine.appendSwitch('proxy-server', options.proxy);
  }

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  try {
    await app.whenReady();

    const pdfBuffers = [];
    for (const input of inputs) {
      const buf = await renderSingleToPdfBuffer({ input, options });
      pdfBuffers.push(buf);
    }

    const mergedBuffer = pdfBuffers.length === 1 ? pdfBuffers[0] : await mergePdfBuffers(pdfBuffers);

    const outPath = path.resolve(process.cwd(), outputFile);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, mergedBuffer);

    process.exit(0);
  } catch (err) {
    process.stderr.write((err && err.stack) ? `${err.stack}\n` : `${String(err)}\n`);
    process.exit(1);
  }
})();
