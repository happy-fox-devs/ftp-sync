import { FTPConnectionQueue } from "../types";

export class FTPConnectionManager {
  private static instance: FTPConnectionManager;
  private readonly maxServerConnections: number = parseInt(
    process.env.FTP_MAX_CONNECTIONS || "50",
  );
  private activeConnections: number = parseInt(
    process.env.FTP_MAX_CONNECTIONS_PER_IP || "5",
  );
  private connectionQueue: Array<FTPConnectionQueue> = [];

  private constructor() {}

  public static getInstance(): FTPConnectionManager {
    if (!FTPConnectionManager.instance) {
      FTPConnectionManager.instance = new FTPConnectionManager();
    }
    return FTPConnectionManager.instance;
  }

  public async acquireConnection(timeoutMs: number = 30000): Promise<number> {
    if (this.activeConnections < this.maxServerConnections) {
      this.activeConnections++;
      return Promise.resolve(this.activeConnections);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.connectionQueue.findIndex(
          (item) => item.resolve === resolve,
        );
        if (index !== -1) {
          this.connectionQueue.splice(index, 1);
          reject(new Error("Connection timeout - server busy"));
        }
      }, timeoutMs);

      this.connectionQueue.push({
        resolve: (value: number) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason?: any) => {
          clearTimeout(timeout);
          reject(reason);
        },
        timestamp: Date.now(),
      });
    });
  }

  public releaseConnection(): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;

      if (this.connectionQueue.length > 0) {
        const next = this.connectionQueue.shift();
        if (next) {
          this.activeConnections++;
          next.resolve(this.activeConnections);
        }
      }
    }
  }

  public getActiveConnections(): number {
    return this.activeConnections;
  }

  public getQueueLength(): number {
    return this.connectionQueue.length;
  }
}
