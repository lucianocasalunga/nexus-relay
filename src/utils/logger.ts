import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = LEVELS[config.logLevel as Level] ?? LEVELS.info;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function emit(level: Level, tag: string, msg: string, data?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const prefix = `${ts()} [${level.toUpperCase().padEnd(5)}] [${tag}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export function logger(tag: string) {
  return {
    debug: (msg: string, data?: unknown) => emit('debug', tag, msg, data),
    info:  (msg: string, data?: unknown) => emit('info', tag, msg, data),
    warn:  (msg: string, data?: unknown) => emit('warn', tag, msg, data),
    error: (msg: string, data?: unknown) => emit('error', tag, msg, data),
  };
}
