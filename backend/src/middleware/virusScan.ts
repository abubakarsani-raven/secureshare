import NodeClam from 'clamscan';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';

type ClamScanner = {
  scanBuffer: (buffer: Buffer) => Promise<{ isInfected: boolean; viruses: string[] }>;
};

let clam: ClamScanner | null = null;
let clamAvailable = false;

export async function initClamAV(): Promise<void> {
  if (!process.env.CLAMAV_HOST) {
    clamAvailable = false;
    logger.info('CLAMAV_HOST not set — virus scanning disabled');
    return;
  }
  try {
    const instance = await new NodeClam().init({
      clamdscan: {
        host: process.env.CLAMAV_HOST,
        port: parseInt(process.env.CLAMAV_PORT || '3310', 10),
        timeout: 120000,
        active: true,
      },
      preference: 'clamdscan',
    });
    clam = instance as ClamScanner;
    clamAvailable = true;
    logger.info('ClamAV initialized');
  } catch (err) {
    clamAvailable = false;
    logger.warn('ClamAV unavailable, virus scanning disabled', { error: String(err) });
  }
}

export async function virusScan(buffer: Buffer): Promise<{ clean: boolean; error?: string }> {
  if (!clamAvailable || !clam) {
    logger.warn('ClamAV scan skipped - service unavailable');
    return { clean: true };
  }

  const tempPath = path.join(os.tmpdir(), `ss-scan-${Date.now()}`);
  try {
    fs.writeFileSync(tempPath, buffer);
    const scanner = clam as unknown as {
      scanFile: (file: string) => Promise<{ isInfected: boolean; viruses: string[] }>;
    };
    const { isInfected, viruses } = await scanner.scanFile(tempPath);
    if (isInfected) {
      logger.warn('Infected file detected', { viruses });
      return { clean: false, error: 'File rejected' };
    }
    return { clean: true };
  } catch (err) {
    logger.warn('ClamAV scan failed, continuing', { error: String(err) });
    return { clean: true };
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}
