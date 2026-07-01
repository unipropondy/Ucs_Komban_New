import { BrowserWindow } from 'electron';
import * as path from 'path';
import { getSecondaryDisplay } from './MonitorService';
import { logger } from '../logger';

let displayWindow: BrowserWindow | null = null;

// Paths differ depending on whether we run in development (src/) or production packaged (dist/)
const getUIPath = () => {
  const { app } = require('electron');
  return path.join(app.getAppPath(), 'customer-display-web', 'index.html');
};

/**
 * Launches the customer display window on the secondary display (if detected).
 */
export function launchCustomerDisplay() {
  const secondary = getSecondaryDisplay();
  if (!secondary) {
    logger.warn('[CustomerDisplay] No secondary monitor found — aborting launch.');
    return;
  }

  if (displayWindow && !displayWindow.isDestroyed()) {
    logger.info('[CustomerDisplay] Window already open.');
    return;
  }

  const { x, y, width, height } = secondary.bounds;
  displayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const uiPath = getUIPath();
  logger.info(`[CustomerDisplay] Loading UI from: ${uiPath}`);

  // Deep-link to the standalone Expo Router route inside the SPA bundle
  displayWindow.loadFile(uiPath, { hash: '/customer-display-standalone' });

  displayWindow.on('closed', () => {
    logger.warn('[CustomerDisplay] Window was closed.');
    displayWindow = null;
  });

  logger.info(`[CustomerDisplay] Window opened successfully on monitor (${width}x${height}).`);
}

/**
 * Closes the customer display window.
 */
export function closeCustomerDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close();
  }
  displayWindow = null;
  logger.info('[CustomerDisplay] Window closed.');
}

/**
 * Pushes customer display state data directly into the React Native Web app inside the BrowserWindow
 * using window.postMessage.
 */
export function pushStateToDisplay(state: any) {
  if (!displayWindow || displayWindow.isDestroyed()) return;

  const payload = JSON.stringify({
    __source: 'electron-print-bridge',
    payload: state,
  });

  displayWindow.webContents
    .executeJavaScript(`window.postMessage(${payload}, '*')`)
    .catch((err) => logger.error(`[CustomerDisplay] Failed to push state to display: ${err.message}`));
}

// 10s Heartbeat watcher: ensures that if the window was closed but the monitor is still attached, it gets relaunched.
setInterval(() => {
  if (getSecondaryDisplay() && (!displayWindow || displayWindow.isDestroyed())) {
    logger.warn('[CustomerDisplay] Heartbeat: window not found but monitor connected. Relaunching...');
    launchCustomerDisplay();
  }
}, 10000);
