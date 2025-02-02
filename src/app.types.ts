import { Client, FileType } from "basic-ftp";

export type FTPConnectionQueue = {
  resolve: (value: number) => void;
  reject: (reason?: any) => void;
  timestamp: number;
};

export type FTPOptionMode = "push" | "pull";

export type FTPOptionOperation = "copy" | "move";

export type FTPSyncOptions = {
  mode: FTPOptionMode;
  operation?: FTPOptionOperation;
};

export type FTPSymbolStatus =
  | "uploaded"
  | "replaced"
  | "identical"
  | "obsolete"
  | "error"
  | "info"
  | "warn"
  | "erro";

export type FTPConfig = {
  host: string;
  user: string;
  pass: string;
  port: number;
  ignore: string[];
  verbose?: string;
};

export type FTPAccessList = Record<number, Client>;

export type SyncList = {
  root: string;
  list: FTPFileInfo[];
};

export type SyncResult = {
  operation: boolean;
};

export type FTPFileInfo = {
  name: string;
  type: FileType;
  modifiedAt?: Date;
  path: { full: string; dir: string; common?: string };
};
