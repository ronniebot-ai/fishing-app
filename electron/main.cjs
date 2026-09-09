'use strict';

const { app, BrowserWindow, protocol, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

/** Built renderer. Packaged builds carry it inside the asar. */
const RENDERER_DIR = path.join(__dirname, '..', 'dist-app');

/** Where the window remembers its size and position between runs. */
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

/**
 * The app is served over a custom scheme rather than file://.
 *
 * A file:// page has an opaque origin, which costs us localStorage — and the
 * ocean-snap cache lives there. Registering a standard, secure scheme gives
 * the renderer an ordinary web origin, so storage, fetch and relative URLs all
 * behave the way they do in the browser build.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Only the two forecast endpoints and the tile server are reachable, and no
 * remote code can load at all. Everything the app runs ships inside it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Leaflet writes element styles, and React sets style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serveRenderer() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '' || rel === '/') rel = '/index.html';

    // Resolve inside the renderer directory, and refuse anything that climbs out.
    const filePath = path.normalize(path.join(RENDERER_DIR, rel));
    if (filePath !== RENDERER_DIR && !filePath.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await fsp.readFile(filePath);
      const headers = {
        'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      };
      // The CSP rides on the document, so it applies to everything it loads.
      if (filePath.endsWith('.html')) headers['Content-Security-Policy'] = CSP;
      return new Response(body, { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function loadWindowState() {
  const fallback = { width: 1180, height: 820 };
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return fallback;
  }
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return fallback;

  // A monitor may have been unplugged since last run; drop off-screen positions.
  const onScreen =
    Number.isFinite(saved.x) &&
    Number.isFinite(saved.y) &&
    screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x < b.x + b.width && saved.x + 80 > b.x && saved.y < b.y + b.height && saved.y + 40 > b.y;
    });

  return {
    width: Math.max(saved.width, 640),
    height: Math.max(saved.height, 480),
    ...(onScreen ? { x: saved.x, y: saved.y } : {}),
    maximized: Boolean(saved.maximized),
  };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const bounds = maximized ? win.getNormalBounds() : win.getBounds();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, maximized }));
  } catch {
    // Remembering the window is a convenience, never a reason to fail a close.
  }
}

function createWindow() {
  const state = loadWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 420,
    minHeight: 520,
    title: 'Tideline',
    // Matches the app's charted-water ground, so no white flash before paint.
    backgroundColor: '#07202e',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Links to somewhere else belong in the user's browser, not in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  let saveTimer;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(win);
  });

  win.loadURL('app://tideline/index.html');
  return win;
}

// One window is the whole app; a second instance should surface the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    serveRenderer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
