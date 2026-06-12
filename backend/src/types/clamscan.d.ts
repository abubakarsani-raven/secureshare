declare module 'clamscan' {
  interface ClamScanOptions {
    clamdscan?: {
      host?: string;
      port?: number;
      timeout?: number;
      active?: boolean;
    };
    preference?: string;
  }

  class NodeClam {
    init(options: ClamScanOptions): Promise<{
      scanFile: (path: string) => Promise<{ isInfected: boolean; viruses: string[] }>;
      scanBuffer: (buffer: Buffer) => Promise<{ isInfected: boolean; viruses: string[] }>;
    }>;
  }

  export = NodeClam;
}
