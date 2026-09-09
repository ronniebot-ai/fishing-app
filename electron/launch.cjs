'use strict';

/**
 * Starts the desktop app in development.
 *
 * Electron-based editors (VS Code, and Claude Code running inside it) export
 * ELECTRON_RUN_AS_NODE=1 into their integrated terminals. Electron honours it
 * and boots as a bare Node process, so `require('electron')` hands back a path
 * string instead of the API and the app dies on `app.getPath`. Clearing the
 * variable for the child is the whole fix.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..')], {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => process.exit(code ?? 0));
