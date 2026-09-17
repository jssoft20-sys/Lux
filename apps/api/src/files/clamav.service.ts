import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'net';
import { SettingsService } from '../settings/settings.service';

export type ScanResult = { status: 'CLEAN' | 'INFECTED' | 'ERROR'; signature?: string; error?: string };

/**
 * Minimal clamd client (INSTREAM protocol) — no shelling out, no temp files.
 * Works with the official `clamav/clamav` docker image on port 3310.
 */
@Injectable()
export class ClamAvService {
  private readonly logger = new Logger(ClamAvService.name);

  constructor(private readonly settings: SettingsService) {}

  private async target() {
    const [host, port] = await Promise.all([this.settings.get('clamav.host'), this.settings.num('clamav.port')]);
    return { host, port };
  }

  private command(cmd: string, payload?: Buffer, timeoutMs = 30_000): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const { host, port } = await this.target();
      const sock = new Socket();
      let out = '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error('clamd timeout'));
      }, timeoutMs);
      sock.setNoDelay(true);
      sock.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on('data', (d) => (out += d.toString()));
      sock.on('close', () => {
        clearTimeout(timer);
        resolve(out.replace(/\0/g, '').trim()); // z-commands return NUL-terminated replies
      });
      sock.connect(port, host, () => {
        sock.write(`z${cmd}\0`);
        if (payload) {
          const chunk = 64 * 1024;
          for (let i = 0; i < payload.length; i += chunk) {
            const part = payload.subarray(i, Math.min(i + chunk, payload.length));
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length, 0);
            sock.write(Buffer.concat([len, part]));
          }
          sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
        }
      });
    });
  }

  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.command('PING', undefined, 5000);
      return { ok: res.includes('PONG'), detail: res || 'no response' };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async version(): Promise<string> {
    try {
      return await this.command('VERSION', undefined, 5000);
    } catch (e) {
      return `unavailable: ${(e as Error).message}`;
    }
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    try {
      const res = await this.command('INSTREAM', buffer);
      if (/\bOK$/.test(res)) return { status: 'CLEAN' };
      const m = /:\s*(.+?)\s+FOUND/.exec(res);
      if (m) return { status: 'INFECTED', signature: m[1] };
      return { status: 'ERROR', error: res || 'empty response' };
    } catch (e) {
      return { status: 'ERROR', error: (e as Error).message };
    }
  }
}
