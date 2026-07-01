import { app as electronApp } from 'electron';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import { startPoller, pollerStats } from './poller';
import { sendToPrinter } from './printer';
import { logger } from './logger';
import {
  startMonitorWatcher,
  monitorEvents,
  getSecondaryDisplay,
} from './customerDisplay/MonitorService';
import {
  launchCustomerDisplay,
  closeCustomerDisplay,
  pushStateToDisplay,
} from './customerDisplay/CustomerDisplayManager';
import { loadPersistedState, getCurrentState } from './customerDisplay/DisplayStateStore';
import displayRouter from './customerDisplay/displayRoutes';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Enable CORS globally with support for credentials (which doesn't allow '*')
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like curl, postman, or mobile apps)
    if (!origin) return callback(null, true);
    
    // Dynamically allow any HTTP/HTTPS origin (localhost, local IP, or Cloudflare Workers POS domain)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Handle preflight OPTIONS requests globally before routes
app.options('*', cors());

// Request single-instance lock
const gotTheLock = electronApp.requestSingleInstanceLock();
if (!gotTheLock) {
  logger.warn('[Electron] Another instance of UniPro Print Bridge is already running. Exiting...');
  electronApp.quit();
  process.exit(0);
}

// 1. GET /health - Local health check of the print bridge
app.get('/health', (req: Request, res: Response) => {
  res.json(pollerStats.getHealth());
});

// 2. POST /test-print - Directly test a kitchen printer from the bridge machine
app.post('/test-print', async (req: Request, res: Response) => {
  const { ip, port } = req.body;
  const targetPort = parseInt(port as string) || 9100;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'Missing printer IP address' });
  }

  const testContent =
    '\x1B\x40' +                      // Initialize printer
    '\x1B\x61\x01' +                  // Center alignment
    'UniPro Print Bridge Test\n' +
    '------------------------\n' +
    `Time: ${new Date().toLocaleString()}\n` +
    `Printer IP: ${ip}\n` +
    `Port: ${targetPort}\n\n\n\n` +
    '\x1D\x56\x41\x00';                // Paper cut command

  try {
    logger.info(`Manual test print initiated for printer: ${ip}:${targetPort}`);
    await sendToPrinter(ip, targetPort, testContent);
    res.json({ success: true, message: `Test receipt sent to printer at ${ip}:${targetPort}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Printing failed' });
  }
});

// 3. POST /direct-test-print - Test simple text payload without formatting
app.post('/direct-test-print', async (req: Request, res: Response) => {
  const { ip, port } = req.body;
  const targetPort = parseInt(port as string) || 9100;

  if (!ip) {
    return res.status(400).json({ success: false, error: 'Missing printer IP address' });
  }

  const testContent = 'HELLO FROM PRINT BRIDGE\n\n\n';

  try {
    logger.info(`Direct simple test print initiated for printer: ${ip}:${targetPort}`);
    await sendToPrinter(ip, targetPort, testContent);
    res.json({ success: true, message: `Direct text sent to printer at ${ip}:${targetPort}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Printing failed' });
  }
});

// Mount new customer display endpoints
app.use('/customer-display', displayRouter);

// Initialize Electron Lifecycle
electronApp.whenReady().then(() => {
  logger.info('[Electron] Platform ready. Starting services...');
  
  loadPersistedState();
  startMonitorWatcher();

  // If a secondary display is already plugged in on start, launch display
  if (getSecondaryDisplay()) {
    launchCustomerDisplay();
  }

  // Handle display changes (added/removed/metrics changes)
  monitorEvents.on('display-changed', () => {
    if (getSecondaryDisplay()) {
      launchCustomerDisplay();
      // Re-push the current state so the display isn't blank/stale after connecting
      setTimeout(() => {
        pushStateToDisplay(getCurrentState());
      }, 2000);
    } else {
      closeCustomerDisplay();
    }
  });

  // Windows Startup Registry Configuration
  electronApp.setLoginItemSettings({
    openAtLogin: true,
    name: 'UniPro Print Bridge',
  });

  // Launch the Express listener + poller
  app.listen(config.port, () => {
    logger.info(`UniPro Print Bridge server listening locally on port ${config.port}`);
    startPoller();
  });
});

// Avoid app shutdown when window closes (our tray/express server remains running)
electronApp.on('window-all-closed', (e: Event) => {
  e.preventDefault();
});
