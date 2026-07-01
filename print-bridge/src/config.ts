import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { BridgeConfig } from './types';
import { logger } from './logger';

const CONFIG_FILENAME = 'config.json';

function loadConfig(): BridgeConfig {
  const execDir = path.dirname(process.execPath);
  const execConfigPath = path.join(execDir, CONFIG_FILENAME);
  const localConfigPath = path.join(process.cwd(), CONFIG_FILENAME);

  let appPath = '';
  try {
    if (app) {
      appPath = app.getAppPath();
    }
  } catch (e) {
    // app might not be initialized or available in dev/testing contexts
  }

  const packageConfigPath = appPath ? path.join(appPath, CONFIG_FILENAME) : '';
  let finalConfigPath = '';

  if (fs.existsSync(execConfigPath)) {
    finalConfigPath = execConfigPath;
  } else if (fs.existsSync(localConfigPath)) {
    finalConfigPath = localConfigPath;
  } else if (packageConfigPath && fs.existsSync(packageConfigPath)) {
    finalConfigPath = packageConfigPath;
  }

  const defaultConfig: BridgeConfig = {
    storeId: 'STORE_001',
    bridgeToken: 'unipro-pos-bridge-token-2026',
    apiUrl: 'https://demo2026pondy-production.up.railway.app',
    pollIntervalMs: 2000,
    port: 3050
  };

  if (!finalConfigPath) {
    logger.warn(`Could not find config.json in exec path, local path, or package. Using built-in defaults.`);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(finalConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as BridgeConfig;
    logger.info(`Loaded configurations successfully from: ${finalConfigPath}`);
    return parsed;
  } catch (err: any) {
    logger.error(`Error reading config.json: ${err.message}. Using built-in defaults.`);
    return defaultConfig;
  }
}

export const config = loadConfig();
