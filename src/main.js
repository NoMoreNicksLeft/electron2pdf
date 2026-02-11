const { app, BrowserWindow } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const SaxonJS = require('saxon-js');
const { spawn } = require('child_process');
const readline = require('readline');

class ExitError extends Error {
  constructor(exitCode) {
    super('exit');
    this.name = 'ExitError';
    this.exitCode = Number(exitCode);
  }
}

function helpAndExit(exitCode) {
  const out = exitCode === 0 ? process.stdout : process.stderr;
  out.write('Name:\n');
  out.write('  electron2pdf\n\n');
  out.write('Synopsis:\n');
  out.write('  electron2pdf [GLOBAL OPTION]... <input url/file name>... <output file>\n\n');
  out.write('Description:\n');
  out.write('  Renders a webpage or local HTML file to a PDF document using Chromium.\n\n');
  out.write('Global Options:\n');
  out.write('  -h, --help                          Display help\n');
  out.write('  -q, --quiet                         Same as using --log-level none\n');
  out.write('      --log-level <level>             none, error, warn, info (default info)\n');
  out.write('      --title <text>                  Set PDF metadata title\n');
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
  out.write('      --stop-slow-scripts             Stop slow running scripts (non-default)\n');
  out.write('      --no-stop-slow-scripts          Do not stop slow running scripts (default)\n');
  out.write('      --custom-header <name> <value>  Add HTTP header (repeatable)\n');
  out.write('      --cookie <name> <value>         Set a cookie for the main URL (repeatable)\n');
  out.write('  -p, --proxy <proxy>                 Use a proxy (passed to Chromium)\n');
  out.write('      --user-style-sheet <path>       Inject CSS from file\n');
  out.write('      --print-media-type              Apply @media print styles before rendering\n');
  out.write('      --no-print-media-type           Do not apply @media print styles (default)\n\n');
  out.write('      --read-args-from-stdin          Read command line arguments from stdin (one invocation per line)\n\n');
  out.write('TOC Options:\n');
  out.write('      toc                              Insert a table of contents as first page\n');
  out.write('      --dump-default-toc-xsl          Dump the default TOC XSL to stdout\n');
  out.write('      --xsl-style-sheet <file>        Use custom XSL to generate TOC HTML\n\n');

  throw new ExitError(exitCode);
}

function defaultTocXsl() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:outline="http://wkhtmltopdf.org/outline"
                xmlns="http://www.w3.org/1999/xhtml">
  <xsl:output doctype-public="-//W3C//DTD XHTML 1.0 Strict//EN"
              doctype-system="http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"
              indent="yes" />
  <xsl:template match="outline:outline">
    <html>
      <head>
        <title>Table of Contents</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <style>
          h1 {
            text-align: center;
            font-size: 20px;
            font-family: arial;
          }
          div {border-bottom: 1px dashed rgb(200,200,200);}
          span {float: right;}
          li {list-style: none;}
          ul {
            font-size: 20px;
            font-family: arial;
          }
          ul ul {font-size: 80%; }
          ul {padding-left: 0em;}
          ul ul {padding-left: 1em;}
          a {text-decoration:none; color: black;}
        </style>
      </head>
      <body>
        <h1>Table of Contents</h1>
        <ul><xsl:apply-templates select="outline:item/outline:item"/></ul>
      </body>
    </html>
  </xsl:template>
  <xsl:template match="outline:item">
    <li>
      <xsl:if test="@title!=''">
        <div>
          <a>
            <xsl:if test="@link">
              <xsl:attribute name="href"><xsl:value-of select="@link"/></xsl:attribute>
            </xsl:if>
            <xsl:if test="@backLink">
              <xsl:attribute name="name"><xsl:value-of select="@backLink"/></xsl:attribute>
            </xsl:if>
            <xsl:value-of select="@title" /> 
          </a>
          <span> <xsl:value-of select="@page" /> </span>
        </div>
      </xsl:if>
      <ul>
        <xsl:comment>added to prevent self-closing tags in QtXmlPatterns</xsl:comment>
        <xsl:apply-templates select="outline:item"/>
      </ul>
    </li>
  </xsl:template>
</xsl:stylesheet>
`;
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

function tokenizeArgLine(line) {
  const s = String(line);
  const out = [];
  let cur = '';
  let quote = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === '\\' && i + 1 < s.length) {
        i++;
        cur += s[i];
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '\\' && i + 1 < s.length) {
      i++;
      cur += s[i];
      continue;
    }

    if (/\s/.test(ch)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }

    cur += ch;
  }

  if (cur.length > 0) out.push(cur);
  return out;
}

function mergeOptions(base, override) {
  const merged = { ...base, ...override };

  merged.customHeaders = [...(base.customHeaders || []), ...(override.customHeaders || [])];
  merged.cookies = [...(base.cookies || []), ...(override.cookies || [])];
  merged.allow = [...(base.allow || []), ...(override.allow || [])];
  merged.bypassProxyFor = [...(base.bypassProxyFor || []), ...(override.bypassProxyFor || [])];
  merged.post = [...(base.post || []), ...(override.post || [])];
  merged.postFile = [...(base.postFile || []), ...(override.postFile || [])];
  merged.runScript = [...(base.runScript || []), ...(override.runScript || [])];
  merged.replace = [...(base.replace || []), ...(override.replace || [])];

  return merged;
}

function parseArgsArray(args, { allowNoPositionals = false } = {}) {

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
    title: undefined,
    stopSlowScripts: false,
    javascriptEnabled: true,
    javascriptDelayMs: 200,
    windowStatus: undefined,
    viewportSize: undefined,
    zoomFactor: 1,
    printMediaType: false,
    toc: false,
    xslStyleSheet: undefined,
    readArgsFromStdin: false,
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

    if (a === '--read-args-from-stdin') {
      options.readArgsFromStdin = true;
      continue;
    }

    if (a === '--dump-default-toc-xsl') {
      process.stdout.write(defaultTocXsl());
      process.exit(0);
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

    if (a === '--title') {
      options.title = String(popValue(i));
      i++;
      continue;
    }

    if (a === '--stop-slow-scripts') {
      options.stopSlowScripts = true;
      continue;
    }

    if (a === '--no-stop-slow-scripts') {
      options.stopSlowScripts = false;
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

    if (a === '--xsl-style-sheet') {
      options.xslStyleSheet = String(popValue(i));
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
    if (!allowNoPositionals) helpAndExit(2);
  }

  if (positionals.length === 0) {
    return { inputs: [], outputFile: undefined, options };
  }

  const outputFile = positionals[positionals.length - 1];
  const inputsRaw = positionals.slice(0, -1);
  const inputs = [];
  for (const p of inputsRaw) {
    if (p === 'toc') {
      options.toc = true;
      continue;
    }
    inputs.push(p);
  }

  if (inputs.length === 0) {
    if (!allowNoPositionals) helpAndExit(2);
  }

  return { inputs, outputFile, options };
}

function parseArgs(argv) {
  return parseArgsArray(argv.slice(2));
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

async function stopSlowScriptsIfNeeded(win, timeoutMs) {
  const idlePromiseJs = `new Promise((resolve) => {
    try {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(true));
      } else {
        setTimeout(() => resolve(true), 0);
      }
    } catch (e) {
      resolve(true);
    }
  })`;

  const idlePromise = win.webContents.executeJavaScript(idlePromiseJs, true);
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));

  const idleWon = await Promise.race([
    idlePromise.then(() => true).catch(() => true),
    timeoutPromise,
  ]);

  if (!idleWon) {
    await win.webContents.executeJavaScript('window.stop && window.stop()', true);
    process.stderr.write('A slow script was stopped\n');
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

  if (options.stopSlowScripts) {
    await stopSlowScriptsIfNeeded(win, 5000);
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

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildOutlineXml(items) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<outline:outline xmlns:outline="http://wkhtmltopdf.org/outline">');
  lines.push('<outline:item>');
  for (const it of items) {
    lines.push(`<outline:item title="${escapeXmlAttr(it.title)}" page="${escapeXmlAttr(it.page)}" link="${escapeXmlAttr(it.link)}"/>`);
  }
  lines.push('</outline:item>');
  lines.push('</outline:outline>');
  return lines.join('\n');
}

function runXslt3Compile({ xslPath, exportPath }) {
  return new Promise((resolve, reject) => {
    const xslt3Path = path.resolve(__dirname, '..', 'node_modules', 'xslt3', 'xslt3.js');
    const args = [xslt3Path, `-xsl:${xslPath}`, `-export:${exportPath}`, '-nogo', '-ns:##html5'];
    const child = spawn(process.execPath, args, { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `xslt3 compile failed with exit code ${code}`));
    });
  });
}

async function getCompiledStylesheetForXsl({ xslText, cacheKey }) {
  const dir = path.join(os.tmpdir(), 'electron2pdf-xslt');
  await fs.promises.mkdir(dir, { recursive: true });
  const xslPath = path.join(dir, `${cacheKey}.xsl`);
  const sefPath = path.join(dir, `${cacheKey}.sef.json`);

  try {
    await fs.promises.access(sefPath);
  } catch {
    await fs.promises.writeFile(xslPath, xslText, 'utf8');
    await runXslt3Compile({ xslPath, exportPath: sefPath });
  }

  const sefJson = await fs.promises.readFile(sefPath, 'utf8');
  return JSON.parse(sefJson);
}

async function tocHtmlFromOutlineXml({ outlineXml, options }) {
  let xslText = defaultTocXsl();
  if (options.xslStyleSheet) {
    const abs = path.resolve(process.cwd(), options.xslStyleSheet);
    xslText = await fs.promises.readFile(abs, 'utf8');
  }

  const cacheKey = crypto.createHash('sha256').update(xslText).digest('hex');
  const stylesheetInternal = await getCompiledStylesheetForXsl({ xslText, cacheKey });

  const result = await SaxonJS.transform({
    stylesheetInternal,
    sourceText: outlineXml,
    destination: 'serialized',
  }, 'async');

  return result.principalResult;
}

(async () => {
  const baseParsed = parseArgsArray(process.argv.slice(2), { allowNoPositionals: true });
  const { inputs, outputFile, options } = baseParsed;

  if (options.proxy) {
    app.commandLine.appendSwitch('proxy-server', options.proxy);
  }

  app.on('window-all-closed', (e) => {
    e.preventDefault();
  });

  try {
    await app.whenReady();

    if (options.readArgsFromStdin) {
      const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

      for await (const line of rl) {
        const trimmed = String(line).trim();
        if (!trimmed) continue;

        const lineArgs = tokenizeArgLine(trimmed);
        let parsed;
        try {
          parsed = parseArgsArray(lineArgs);
        } catch (e) {
          if (e && e.name === 'ExitError' && Number.isInteger(Number(e.exitCode))) {
            process.exit(Number(e.exitCode));
            return;
          }
          throw e;
        }
        const mergedOptions = mergeOptions(options, parsed.options);
        const invInputs = parsed.inputs;
        const invOutput = parsed.outputFile;

        if (!invInputs || invInputs.length === 0 || !invOutput) {
          helpAndExit(2);
        }

        const invPdfBuffers = [];
        const invPageCounts = [];
        for (const input of invInputs) {
          const buf = await renderSingleToPdfBuffer({ input, options: mergedOptions });
          invPdfBuffers.push(buf);
          const doc = await PDFDocument.load(buf);
          invPageCounts.push(doc.getPageCount());
        }

        let mergedPagesBuffer = invPdfBuffers.length === 1 ? invPdfBuffers[0] : await mergePdfBuffers(invPdfBuffers);

        if (mergedOptions.toc) {
          let tocPdfBuffer = null;
          let tocPageCount = 1;

          for (let iter = 0; iter < 3; iter++) {
            let pageCursor = tocPageCount + 1;
            const items = invInputs.map((inp, idx) => {
              const title = String(inp);
              const link = normalizeInputToUrl(inp);
              const page = pageCursor;
              pageCursor += invPageCounts[idx];
              return { title, link, page };
            });

            const outlineXml = buildOutlineXml(items);
            const tocHtml = await tocHtmlFromOutlineXml({ outlineXml, options: mergedOptions });
            const tocDataUrl = `data:text/html;base64,${Buffer.from(tocHtml, 'utf8').toString('base64')}`;
            tocPdfBuffer = await renderSingleToPdfBuffer({ input: tocDataUrl, options: mergedOptions });
            const tocDoc = await PDFDocument.load(tocPdfBuffer);
            const newCount = tocDoc.getPageCount();
            if (newCount === tocPageCount) break;
            tocPageCount = newCount;
          }

          mergedPagesBuffer = await mergePdfBuffers([tocPdfBuffer, mergedPagesBuffer]);
        }

        const mergedBuffer = mergedPagesBuffer;
        let finalBuffer = mergedBuffer;
        if (mergedOptions.title) {
          const doc = await PDFDocument.load(mergedBuffer);
          doc.setTitle(mergedOptions.title);
          finalBuffer = Buffer.from(await doc.save());
        }

        const outPath = path.resolve(process.cwd(), invOutput);
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        await fs.promises.writeFile(outPath, finalBuffer);
      }

      process.exit(0);
      return;
    }

    if (!outputFile || !inputs || inputs.length === 0) {
      helpAndExit(2);
    }

    const pdfBuffers = [];
    const pageCounts = [];
    for (const input of inputs) {
      const buf = await renderSingleToPdfBuffer({ input, options });
      pdfBuffers.push(buf);
      const doc = await PDFDocument.load(buf);
      pageCounts.push(doc.getPageCount());
    }

    let mergedPagesBuffer = pdfBuffers.length === 1 ? pdfBuffers[0] : await mergePdfBuffers(pdfBuffers);

    if (options.toc) {
      let tocPdfBuffer = null;
      let tocPageCount = 1;

      for (let iter = 0; iter < 3; iter++) {
        let pageCursor = tocPageCount + 1;
        const items = inputs.map((inp, idx) => {
          const title = String(inp);
          const link = normalizeInputToUrl(inp);
          const page = pageCursor;
          pageCursor += pageCounts[idx];
          return { title, link, page };
        });

        const outlineXml = buildOutlineXml(items);
        const tocHtml = await tocHtmlFromOutlineXml({ outlineXml, options });
        const tocDataUrl = `data:text/html;base64,${Buffer.from(tocHtml, 'utf8').toString('base64')}`;
        tocPdfBuffer = await renderSingleToPdfBuffer({ input: tocDataUrl, options });
        const tocDoc = await PDFDocument.load(tocPdfBuffer);
        const newCount = tocDoc.getPageCount();
        if (newCount === tocPageCount) break;
        tocPageCount = newCount;
      }

      mergedPagesBuffer = await mergePdfBuffers([tocPdfBuffer, mergedPagesBuffer]);
    }

    const mergedBuffer = mergedPagesBuffer;

    let finalBuffer = mergedBuffer;
    if (options.title) {
      const doc = await PDFDocument.load(mergedBuffer);
      doc.setTitle(options.title);
      finalBuffer = Buffer.from(await doc.save());
    }

    const outPath = path.resolve(process.cwd(), outputFile);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, finalBuffer);

    process.exit(0);
  } catch (err) {
    if (err && err.name === 'ExitError' && Number.isInteger(Number(err.exitCode))) {
      process.exit(Number(err.exitCode));
    }
    process.stderr.write((err && err.stack) ? `${err.stack}\n` : `${String(err)}\n`);
    process.exit(1);
  }
})();
