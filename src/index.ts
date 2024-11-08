import { Client, FTPError } from "basic-ftp";
import fs from "fs";
import { mkdir, readdir, rmdir, unlink, utimes } from "fs/promises";
import Ignore from "ignore";
import path from "path";
import { FTPConnectionManager } from "./lib/FTPConnectionManager";
import { FTPSymbols } from "./models/FileSymbols";
import {
  FTPAccessList,
  FTPConfig,
  FTPFileInfo,
  FTPSymbolMode,
  SyncList,
} from "./types";

export class FTPClient {
  private connectionManager: FTPConnectionManager;
  private accessList: FTPAccessList = {};
  private config: FTPConfig;
  private ignore: ReturnType<typeof Ignore>;
  private util: FTPSymbols;

  constructor(config: FTPConfig) {
    const { ignore = [] } = config;

    this.util = new FTPSymbols(config.verbose);

    this.config = config;
    this.ignore = Ignore().add(ignore);
    this.connectionManager = FTPConnectionManager.getInstance();
  }

  public async sync(local: string, remote: string, mode: FTPSymbolMode) {
    const srcRoot = mode === "local" ? remote : local;
    const desRoot = mode === "local" ? local : remote;

    await this.connectionManager.acquireConnection();
    const access = await this.connect();

    this.util.taskLog(
      mode,
      "info",
      "\nGetting file list, this may take a while...",
    );

    const source = {
      root: srcRoot,
      list: await this.getFiles(
        access,
        srcRoot,
        mode === "local" ? "remote" : "local",
        true,
      ),
    };

    const destination = {
      root: desRoot,
      list: await this.getFiles(
        access,
        desRoot,
        mode === "local" ? "local" : "remote",
        true,
      ),
    };

    this.util.taskLog(
      mode,
      "info",
      `${source.list.length} files to ${mode === "local" ? "download" : "upload"}`,
    );
    this.util.taskLog(mode, "info", "Starting synchronization...");
    this.util.taskLog(
      mode,
      "info",
      `${source.root} ${mode === "local" ? "<<<" : ">>>"} ${destination.root}`,
    );

    this.disconnect(access);
    this.connectionManager.releaseConnection();

    return await this.startSyncTasks(source, destination, mode);
  }

  private async getAccess() {
    const client = new Client();
    await client.access({
      host: this.config.host,
      user: this.config.user,
      password: this.config.pass,
      port: this.config.port,
    });

    return client;
  }

  private async connect() {
    const client = new Client();
    // client.ftp.verbose = true;

    await client.access({
      host: this.config.host,
      user: this.config.user,
      password: this.config.pass,
      port: this.config.port,
    });
    const id = new Date().getTime();
    this.accessList[id] = client;
    return id;
  }

  private disconnect(id: number) {
    this.accessList[id].close();
    delete this.accessList[id];
  }

  private async getFiles(
    access: number,
    directory: string,
    mode: "remote" | "local",
    recursive: boolean = false,
    root?: string,
  ) {
    const files: FTPFileInfo[] = [];
    let list: FTPFileInfo[] = [];

    if (mode === "remote") {
      await this.accessList[access].cd(directory);
      list = (await this.accessList[access].list()).map((file) => {
        const fullPath = (
          root ? path.join(root, file.name) : file.name
        ).replace(/\\/g, "/");
        const dir = fullPath.split("/").slice(0, -1).join("/");
        return {
          path: { full: fullPath, dir },
          name: file.name,
          type: file.type,
          modifiedAt: file.modifiedAt,
        } as FTPFileInfo;
      });
    } else if (mode === "local") {
      const dirFiles = fs.readdirSync(root ?? directory);
      list = await Promise.all(
        dirFiles.map(async (name): Promise<FTPFileInfo> => {
          const stat = await fs.promises.stat(
            path.join(root ?? directory, name),
          );
          const type = stat.isDirectory() ? 2 : 1;
          const modifiedAt = stat.mtime ?? stat.ctime;

          const fullPath = path
            .join(root ?? directory, name)
            .replace(/\\/g, "/");
          const dir = fullPath.split("/").slice(0, -1).join("/");

          return {
            path: { full: fullPath, dir },
            name,
            type,
            modifiedAt,
          } as FTPFileInfo;
        }),
      );
    }

    for (const file of list) {
      const fullPath = path
        .join(root ?? directory, file.name)
        .replace(/\\/g, "/");

      if (this.ignore.ignores(file.name)) {
        continue;
      }

      if (file.type === 2) {
        if (recursive) {
          const subFiles = await this.getFiles(
            access,
            file.name,
            mode,
            true,
            fullPath,
          );
          files.push(...subFiles);

          if (mode === "remote") {
            await this.accessList[access].cdup();
          }
        }
      } else {
        const spplited = fullPath.split("/");
        spplited.pop();

        const dir = spplited.join("/");

        files.push({
          path: { full: fullPath.replace(/\\/g, "/"), dir },
          name: file.name,
          type: file.type as any,
          modifiedAt: file.modifiedAt,
        });
      }
    }

    return files;
  }

  private async startSyncTasks(
    source: SyncList,
    destination: SyncList,
    mode: FTPSymbolMode,
  ) {
    console.log(" ");
    const effectiveMaxConnections = 5;
    const { root: sourceRoot, list: sourceList } = source;
    const { root: destinationRoot, list: destinationList } = destination;

    let activeTasks = 0;
    let allTasksCompleted = false;

    await new Promise<boolean>((resolve, reject) => {
      const processNextFile = async () => {
        if (activeTasks >= effectiveMaxConnections) return;
        let filename = "";

        try {
          await this.connectionManager.acquireConnection();
          activeTasks++;
          const access = await this.connect();

          try {
            const sourceFile = sourceList.shift();
            if (sourceFile?.path) {
              sourceFile.path.common = sourceFile.path.full.slice(
                sourceRoot.length,
              );
              const index = destinationList.findIndex((destFile) => {
                destFile.path.common = destFile.path.full.slice(
                  destinationRoot.length,
                );
                return destFile.path.common === sourceFile.path.common;
              });

              const destinationFile =
                index !== -1 ? destinationList.splice(index, 1)[0] : null;

              if (!destinationFile) {
                if (mode === "remote") {
                  const dir = sourceRoot + sourceFile.path.dir;
                  await this.accessList[access].ensureDir(dir);
                  await this.accessList[access].cd("/");
                } else if (mode === "local") {
                  const fullPath = path
                    .join(destinationRoot, sourceFile.path.common)
                    .replace(/\\/g, "/");
                  const dir = fullPath.split("/").slice(0, -1).join("/");
                  await mkdir(dir, { recursive: true });

                  const ws = fs.createWriteStream(fullPath);
                  ws.close();

                  await this.accessList[access].cd("/");
                }
              } else if (
                sourceFile.modifiedAt &&
                destinationFile.modifiedAt &&
                sourceFile.modifiedAt <= destinationFile.modifiedAt
              ) {
                this.util.taskLog(mode, "identical", sourceFile.path.common);
                return;
              }

              if (mode === "remote") {
                await this.accessList[access].uploadFrom(
                  sourceFile.path.full,
                  destinationFile?.path.full || sourceFile.path.full,
                );
              } else if (mode === "local") {
                await this.accessList[access].downloadTo(
                  path.join(destinationRoot, sourceFile.path.common),
                  sourceFile.path.full,
                );
                await utimes(
                  path.join(destinationRoot, sourceFile.path.common),
                  sourceFile.modifiedAt ?? Date.now(),
                  sourceFile.modifiedAt ?? Date.now(),
                );
              }

              if (
                sourceFile.modifiedAt &&
                destinationFile?.modifiedAt &&
                sourceFile.modifiedAt > destinationFile.modifiedAt
              ) {
                this.util.taskLog(mode, "replaced", sourceFile.path.common);
              } else {
                this.util.taskLog(mode, "uploaded", sourceFile.path.common);
              }
            } else if (destinationList.length > 0) {
              const obsoleteFile = destinationList.shift();
              if (obsoleteFile?.path?.full) {
                await this.accessList[access].cd("/");
                const dir = path.join(destinationRoot, obsoleteFile.path.dir);

                filename = obsoleteFile.path.full.slice(destinationRoot.length);
                if (mode === "remote") {
                  await this.accessList[access].remove(obsoleteFile.path.full);
                  await this.accessList[access].removeEmptyDir(dir);
                } else if (mode === "local") {
                  await unlink(obsoleteFile.path.full);
                  if ((await readdir(dir)).length === 0) {
                    await rmdir(dir);
                  }
                }

                this.util.taskLog(mode, "obsolete", filename);
              }
            } else {
              allTasksCompleted = true;
            }
          } catch (error: any) {
            if (error instanceof FTPError) {
              this.util.taskLog(mode, "error", filename, error.code);
            } else {
              console.error("Error processing file:", error.message);
            }
          } finally {
            this.disconnect(access);
            this.connectionManager.releaseConnection();
            activeTasks--;

            setImmediate(processNextFile);
          }
        } catch (error: any) {
          console.error("Connection error:", error.message);
          activeTasks--;
          this.connectionManager.releaseConnection();
          reject(error);
        }
      };

      const intervalId = setInterval(() => {
        if (allTasksCompleted) {
          clearInterval(intervalId);
          resolve(true);
        }
      }, 1000);
      let totalTasks;

      if (!sourceList.length || !destinationList.length) {
        totalTasks = Math.max(sourceList.length, destinationList.length);
      } else {
        const min = Math.min(sourceList.length, destinationList.length);
        const max = Math.max(sourceList.length, destinationList.length);
        const dif = max - min;
        totalTasks = max + dif;
      }

      const maxConection =
        totalTasks >= 5 ? effectiveMaxConnections : totalTasks;
      for (let i = 0; i < maxConection; i++) {
        processNextFile();
      }
    });

    console.log(" ");
    return true;
  }
}
