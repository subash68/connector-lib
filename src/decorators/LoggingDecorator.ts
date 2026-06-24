import { ConnectorDecorator } from "./ConnectorDecorator";
import type { IBaseConnector } from "../interfaces/IBaseConnector";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: Logger = {
  log(level, message, meta) {
    const entry = { level, message, ts: new Date().toISOString(), ...meta };
    if (level === "error") {
      console.error(JSON.stringify(entry));
    } else if (level === "warn") {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  },
};

export class LoggingDecorator extends ConnectorDecorator {
  private readonly logger: Logger;

  constructor(wrapped: IBaseConnector, logger: Logger = defaultLogger) {
    super(wrapped);
    this.logger = logger;
  }

  override async connect(): Promise<void> {
    return this.withLogging("connect", () => super.connect());
  }

  override async disconnect(): Promise<void> {
    return this.withLogging("disconnect", () => super.disconnect());
  }

  override getBlockNumber(): Promise<bigint> {
    return this.withLogging("getBlockNumber", () => super.getBlockNumber());
  }

  override getBalance(address: string): Promise<bigint> {
    return this.withLogging("getBalance", () => super.getBalance(address), {
      address,
    });
  }

  private async withLogging<T>(
    method: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> {
    const start = Date.now();
    this.logger.log("debug", `${method} called`, {
      chain: this.networkName,
      ...meta,
    });
    try {
      const result = await fn();
      this.logger.log("info", `${method} succeeded`, {
        chain: this.networkName,
        durationMs: Date.now() - start,
        ...meta,
      });
      return result;
    } catch (err) {
      this.logger.log("error", `${method} failed`, {
        chain: this.networkName,
        durationMs: Date.now() - start,
        error: String(err),
        ...meta,
      });
      throw err;
    }
  }
}
