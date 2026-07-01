import * as net from 'net';
import { logger } from './logger';

/**
 * Parses tags like [C], [L], [R], <B>, </B>, <font size='big'> to ESC/POS binary buffers.
 */
function parseFormatting(content: string): Buffer {
  const chunks: Buffer[] = [];
  
  // Tag translation regex
  const tagRegex = /(\[C\]|\[L\]|\[R\]|<\/?B>|<font size='big'>|<font size='normal'>|<\/font>)/gi;
  const parts = content.split(tagRegex);
  
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === '[c]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x01])); // Align center
    } else if (lower === '[l]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x00])); // Align left
    } else if (lower === '[r]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x02])); // Align right
    } else if (lower === '<b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x01])); // Bold on
    } else if (lower === '</b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x00])); // Bold off
    } else if (lower === "<font size='big'>" || lower === "<font size=\"big\">") {
      chunks.push(Buffer.from([0x1D, 0x21, 0x11])); // Double width + double height
    } else if (lower === "<font size='normal'>" || lower === "<font size=\"normal\">" || lower === '</font>') {
      chunks.push(Buffer.from([0x1D, 0x21, 0x00])); // Reset font size
    } else {
      chunks.push(Buffer.from(part, 'utf-8'));
    }
  }
  
  // Append line feeds and paper cut command (GS V 66 0)
  chunks.push(Buffer.from([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00]));
  
  return Buffer.concat(chunks);
}

/**
 * Sends a raw data payload to a LAN/Wi-Fi thermal printer using a TCP socket connection.
 * Supports both base64 binary encoding and standard UTF-8 string encoding with tag translation.
 */
export function sendToPrinter(ip: string, port: number, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const client = new net.Socket();
    const timeoutVal = 30000; // Increased to 30 seconds for diagnostic testing

    client.setTimeout(timeoutVal);

    logger.info(`[PRINT BRIDGE] Preparing job for printer at ${ip}:${port}`);
    logger.info(`[PRINT BRIDGE] Current timeout setting: ${timeoutVal}ms`);
    logger.info(`[PRINT BRIDGE] Content preview (first 300 chars): "${content.slice(0, 300)}"`);

    let payload: Buffer;
    
    // Quick heuristic to check if content is base64 encoded binary
    const trimmed = content.trim();
    const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && (trimmed.length % 4 === 0);

    if (isBase64) {
      logger.info(`[PRINT BRIDGE] Detected base64 binary payload`);
      payload = Buffer.from(trimmed, 'base64');
    } else {
      logger.info(`[PRINT BRIDGE] Detected text payload - parsing ESC/POS format tags`);
      payload = parseFormatting(content);
    }

    logger.info(`[PRINT BRIDGE] Connecting to printer... IP: ${ip}, Port: ${port}, Payload length: ${payload.length} bytes`);

    client.connect(port, ip, () => {
      const elapsed = Date.now() - startTime;
      logger.info(`[PRINT BRIDGE] Socket connected after ${elapsed}ms`);
      
      logger.info(`[PRINT BRIDGE] Writing payload...`);
      client.write(payload, () => {
        const writeElapsed = Date.now() - startTime;
        logger.info(`[PRINT BRIDGE] Payload written successfully (Total elapsed: ${writeElapsed}ms)`);
        
        client.end();
      });
    });

    client.on('close', () => {
      const closeElapsed = Date.now() - startTime;
      logger.info(`[PRINT BRIDGE] Socket closed (Total elapsed: ${closeElapsed}ms)`);
      resolve();
    });

    client.on('error', (err: any) => {
      client.destroy();
      const errElapsed = Date.now() - startTime;
      logger.error(`[PRINT BRIDGE] TCP Socket error after ${errElapsed}ms:`, err);
      reject(err);
    });

    client.on('timeout', () => {
      client.destroy();
      const elapsed = Date.now() - startTime;
      logger.error(`[PRINT BRIDGE] Socket timeout after ${elapsed}ms (Timeout limit: ${timeoutVal}ms)`);
      reject(new Error(`Connection to printer timed out after ${elapsed}ms`));
    });
  });
}
