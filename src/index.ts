import { Client, FTPError } from "basic-ftp";
import fs, { existsSync } from "fs";
import { mkdir, readdir, rmdir, unlink, utimes } from "fs/promises";
import Ignore from "ignore";
import desDir, { join } from "path";
import { FTPConnectionManager } from "./lib/FTPConnectionManager";
import { FTPSymbols } from "./models/FileSymbols";
import {
  FTPAccessList,
  FTPConfig,
  FTPFileInfo,
  FTPOptionMode,
  FTPOptionOperation,
  FTPSyncOptions,
  SyncList,
} from "./app.types";

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

  public async sync(local: string, remote: string, options: FTPSyncOptions) {
    const { mode, operation = "copy" } = options;

    await this.connectionManager.acquireConnection();
    const access = await this.connect();

    this.util.breakLine();
    this.util.taskLog(mode, "info", "Getting file list, this may take a while...");

    const localObj = {
      root: local,
      list: await this.getLocalFiles(access, local, true),
    };

    const remoteObj = {
      root: remote,
      list: await this.getRemoteFiles(access, remote, true),
    };

    this.util.taskLog(
      mode,
      "info",
      `${mode === "pull" ? remoteObj.list.length : localObj.list.length} files to sync`
    );
    this.util.taskLog(mode, "info", "Starting synchronization...");
    this.util.taskLog(
      mode,
      "info",
      `${localObj.root} ${mode === "pull" ? "<<<" : ">>>"} ${remoteObj.root}`
    );

    this.disconnect(access);
    this.connectionManager.releaseConnection();

    return await this.startSyncTasks(localObj, remoteObj, mode, operation);
  }

  private async connect() {
    const client = new Client();
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

  private async getRemoteFiles(
    access: number,
    directory: string,
    recursive: boolean = false,
    root?: string
  ) {
    const files: FTPFileInfo[] = [];
    await this.accessList[access].cd(directory);

    let list = (await this.accessList[access].list()).map((file) => {
      const fullPath = (root ? join(root, file.name) : file.name).replace(/\\/g, "/");
      const dir = fullPath.split("/").slice(0, -1).join("/");
      return {
        path: { full: fullPath, dir },
        name: file.name,
        type: file.type,
        modifiedAt: file.modifiedAt,
      } as FTPFileInfo;
    });

    for (const file of list) {
      const fullPath = desDir.join(root ?? directory, file.name).replace(/\\/g, "/");

      if (this.ignore.ignores(file.name)) {
        continue;
      }

      if (file.type === 2) {
        if (recursive) {
          const subFiles = await this.getRemoteFiles(access, file.name, true, fullPath);
          files.push(...subFiles);

          await this.accessList[access].cdup();
        }
      } else {
        const spplited = fullPath.split("/");
        spplited.pop();

        const dir = spplited.join("/");

        files.push({
          path: { full: fullPath.replace(/\\/g, "/"), dir, common: "" },
          name: file.name,
          type: file.type as any,
          modifiedAt: file.modifiedAt,
        });
      }
    }

    return files;
  }

  private async getLocalFiles(
    access: number,
    directory: string,
    recursive: boolean = false,
    root?: string
  ) {
    const files: FTPFileInfo[] = [];
    const dirFiles = fs.readdirSync(root ?? directory);

    let list = await Promise.all(
      dirFiles.map(async (name): Promise<FTPFileInfo> => {
        const stat = await fs.promises.stat(join(root ?? directory, name));
        const type = stat.isDirectory() ? 2 : 1;
        const modifiedAt = stat.mtime ?? stat.ctime;

        const fullPath = join(root ?? directory, name).replace(/\\/g, "/");
        const dir = fullPath.split("/").slice(0, -1).join("/");

        return {
          path: { full: fullPath, dir },
          name,
          type,
          modifiedAt,
        } as FTPFileInfo;
      })
    );

    for (const file of list) {
      const fullPath = desDir.join(root ?? directory, file.name).replace(/\\/g, "/");

      if (this.ignore.ignores(file.name)) {
        continue;
      }

      if (file.type === 2) {
        if (recursive) {
          const subFiles = await this.getLocalFiles(access, file.name, true, fullPath);
          files.push(...subFiles);
        }
      } else {
        const spplited = fullPath.split("/");
        spplited.pop();

        const dir = spplited.join("/");

        files.push({
          path: { full: fullPath.replace(/\\/g, "/"), dir, common: "" },
          name: file.name,
          type: file.type as any,
          modifiedAt: file.modifiedAt,
        });
      }
    }

    return files;
  }

  private async startSyncTasks(
    local: SyncList,
    remote: SyncList,
    mode: FTPOptionMode,
    operation?: FTPOptionOperation
  ) {
    this.util.breakLine();
    const effectiveMaxConnections = 5;
    const src = mode === "pull" ? remote : local;
    const des = mode === "pull" ? local : remote;

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
            const srcFile = src.list.shift();

            if (srcFile?.path) {
              srcFile.path.common = srcFile.path.full.slice(src.root.length);
              const index = des.list.findIndex((desFile) => {
                desFile.path.common = desFile.path.full.slice(des.root.length);
                return desFile.path.common === srcFile.path.common;
              });

              const desFile = index >= 0 && des.list.splice(index, 1)[0];

              if (desFile) {
                const checkDate = () => {
                  if (!srcFile.modifiedAt || !desFile.modifiedAt) return false;
                  const srcTime = srcFile.modifiedAt.getTime();
                  const desTime = desFile.modifiedAt.getTime();
                  if (srcTime === desTime) {
                    this.util.taskLog(mode, "identical", srcFile.path.common);
                    return false;
                  }

                  if (srcTime < desTime) {
                    this.util.taskLog(mode, "info", srcFile.path.common, "is newer");
                    return false;
                  }

                  return true;
                };

                const canOverwrite = checkDate();

                if (canOverwrite) {
                  if (mode === "pull") {
                    await this.accessList[access].cd("/");
                    await this.accessList[access].downloadTo(desFile.path.full, srcFile.path.full);
                  }

                  if (mode === "push") {
                    await this.accessList[access].cd("/");
                    await this.accessList[access].uploadFrom(srcFile.path.full, desFile.path.full);
                  }
                  this.util.taskLog(mode, "replaced", srcFile.path.common);
                }
              } else {
                await this.accessList[access].cd("/");
                if (mode === "pull") {
                  const dir = des.root + (srcFile.path.dir.slice(src.root.length) || "");
                  const path = des.root + srcFile.path.common;
                  if (!existsSync(dir)) {
                    await mkdir(dir, { recursive: true });
                  }
                  await new Promise((resolve) => {
                    const ws = fs.createWriteStream(path);
                    ws.on("close", () => {
                      resolve(true);
                    });
                    ws.close();
                  });
                  await this.accessList[access].downloadTo(path, src.root + srcFile.path.common);
                  await utimes(
                    path,
                    srcFile.modifiedAt ?? Date.now(),
                    srcFile.modifiedAt ?? Date.now()
                  );
                }

                if (mode === "push") {
                  const dir = des.root + (srcFile.path.dir.slice(src.root.length) || "");
                  const filePath = src.root + srcFile.path.common;
                  const destPath = des.root + srcFile.path.common;
                  await this.accessList[access].ensureDir(dir);
                  await this.accessList[access].cd("/");
                  await this.accessList[access].uploadFrom(filePath, destPath);
                }

                this.util.taskLog(mode, "uploaded", srcFile.path.common);
              }

              if (operation === "move") {
                if (mode === "pull") {
                  await this.accessList[access].remove(srcFile.path.full);
                  const list = await this.accessList[access].list(srcFile.path.dir);
                  if (list.length === 0 && srcFile.path.dir !== src.root) {
                    await this.accessList[access].removeEmptyDir(srcFile.path.dir);
                  }
                }

                if (mode === "push") {
                  await unlink(srcFile.path.full);
                  if (
                    (await readdir(srcFile.path.dir)).length === 0 &&
                    srcFile.path.dir !== src.root
                  ) {
                    await rmdir(srcFile.path.dir);
                  }
                }
              }
            } else if (des.list.length > 0) {
              const desFile = des.list.shift();

              if (!desFile) return;

              await this.accessList[access].cd("/");

              if (mode === "pull") {
                await unlink(desFile.path.full);
                if ((await readdir(desFile.path.dir)).length === 0) {
                  await rmdir(desFile.path.dir);
                }
              }

              if (mode === "push") {
                await this.accessList[access].remove(desFile.path.full);
                const list = await this.accessList[access].list(desFile.path.dir);
                if (list.length === 0) {
                  await this.accessList[access].removeEmptyDir(desFile.path.dir);
                }
              }

              this.util.taskLog(mode, "obsolete", filename);
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

            if (!allTasksCompleted) setImmediate(processNextFile);
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

      if (!src.list.length || !des.list.length) {
        totalTasks = Math.max(src.list.length, des.list.length);
      } else {
        const min = Math.min(src.list.length, des.list.length);
        const max = Math.max(src.list.length, des.list.length);
        const dif = max - min;
        totalTasks = max + dif;
      }

      const maxConection = totalTasks >= 5 ? effectiveMaxConnections : totalTasks;
      for (let i = 0; i < maxConection; i++) {
        processNextFile();
      }
    });

    this.util.breakLine();
    return true;
  }
}
