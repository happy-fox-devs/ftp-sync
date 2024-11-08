import { FTPSymbolMode, FTPSymbolStatus } from "../types";

export class FTPSymbols {
  public static readonly general = {
    info: "\x1b[34mINF\x1b[0m",
    warn: "\x1b[33mWAR\x1b[0m",
    erro: "\x1b[31mERR\x1b[0m",
    break: "   ",
  };

  public static readonly remote = {
    uploaded: "\x1b[32m>>>\x1b[0m",
    replaced: "\x1b[33m->>\x1b[0m",
    identical: "\x1b[37m===\x1b[0m",
    obsolete: "\x1b[35m>>x\x1b[0m",
    error: "\x1b[31mxxx\x1b[0m",
    ...FTPSymbols.general,
  };

  public static readonly local = {
    uploaded: "\x1b[32m<<<\x1b[0m",
    replaced: "\x1b[33m<<-\x1b[0m",
    identical: "\x1b[37m===\x1b[0m",
    obsolete: "\x1b[35mx<<\x1b[0m",
    error: "\x1b[31mxxx\x1b[0m",
    ...FTPSymbols.general,
  };

  private verbose: string;

  constructor(verbose: string = "false") {
    this.verbose = verbose;
  }

  public transferColorGuide() {
    console.log("\x1b[32m%s\x1b[0m", "Uploaded");
    console.log("\x1b[33m%s\x1b[0m", "Replaced");
    console.log("\x1b[37m%s\x1b[0m", "Identical");
    console.log("\x1b[35m%s\x1b[0m", "Obsolete");
    console.log("\x1b[31m%s\x1b[0m", "Error");
  }

  public taskLog(
    mode: FTPSymbolMode,
    status: FTPSymbolStatus,
    ...message: (string | number)[]
  ) {
    if (this.verbose === "false") return;

    const _mode = mode === "remote" ? "remote" : "local";
    const _status = status === "info" ? "info" : status;

    const symbol = FTPSymbols[_mode][_status];

    console.log(` ${symbol} | ${message}`);
  }
}
