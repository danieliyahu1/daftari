type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function write(level: Level, message: string, extra?: Record<string, unknown>): void {
  if (import.meta.env.MODE === 'test') return
  if (LEVEL_ORDER[level] < LEVEL_ORDER.debug) return
  const line = extra !== undefined ? `${message} ${JSON.stringify(extra)}` : message
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'info' : level](`[daftari:${level}] ${line}`)
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>): void => write('debug', message, extra),
  info: (message: string, extra?: Record<string, unknown>): void => write('info', message, extra),
  warn: (message: string, extra?: Record<string, unknown>): void => write('warn', message, extra),
  error: (message: string, extra?: Record<string, unknown>): void => write('error', message, extra),
}
