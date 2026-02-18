interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'debug' | 'info';
  message: string;
  data?: unknown[];
  timestamp: string;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
    info: typeof console.info;
  } | null = null;
  private maxLogs: number = 500;
  private isInitialized: boolean = false;

  init(): void {
    if (this.isInitialized) return;

    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      info: console.info,
    };

    this.interceptConsole('log', console.log);
    this.interceptConsole('warn', console.warn);
    this.interceptConsole('error', console.error);
    this.interceptConsole('debug', console.debug);
    this.interceptConsole('info', console.info);

    this.isInitialized = true;
    this.originalConsole.log('[LoggerService] Console interception initialized');
  }

  private interceptConsole(
    level: 'log' | 'warn' | 'error' | 'debug' | 'info',
    originalFn: typeof console.log
  ): void {
    console[level] = (...args: unknown[]) => {
      const message = args[0]?.toString() || '';
      const data = args.slice(1);

      this.logs.push({
        level,
        message,
        data: data.length > 0 ? data : undefined,
        timestamp: new Date().toISOString(),
      });

      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }

      originalFn.apply(console, args);
    };
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getFormattedLogs(): string {
    const deviceInfo = this.getDeviceInfo();
    const lines: string[] = [
      '=== Jump & Say Bug Report ===',
      `Generated: ${new Date().toISOString()}`,
      '',
      '--- Device Info ---',
      deviceInfo,
      '',
      '--- Logs ---',
      '',
    ];

    this.logs.forEach((entry) => {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
      if (entry.data && entry.data.length > 0) {
        lines.push(`${prefix} ${entry.message}`);
        entry.data.forEach((d) => {
          lines.push(`  -> ${JSON.stringify(d, null, 2)}`);
        });
      } else {
        lines.push(`${prefix} ${entry.message}`);
      }
    });

    return lines.join('\n');
  }

  private getDeviceInfo(): string {
    const ua = navigator.userAgent;
    const isIPad = /iPad|Macintosh/i.test(ua) && 'ontouchend' in document;
    const isAndroid = /Android/i.test(ua);
    const isMobilePhone = /iPhone|Android|Mobile/i.test(ua) && !/iPad|Tablet/i.test(ua);

    return [
      `User Agent: ${ua}`,
      `Screen: ${window.screen.width}x${window.screen.height}`,
      `Viewport: ${window.innerWidth}x${window.innerHeight}`,
      `Device Pixel Ratio: ${window.devicePixelRatio}`,
      `iPad: ${isIPad}`,
      `Android: ${isAndroid}`,
      `Mobile Phone: ${isMobilePhone}`,
      `Online: ${navigator.onLine}`,
    ].join('\n');
  }

  clearLogs(): void {
    this.logs = [];
  }

  destroy(): void {
    if (this.originalConsole) {
      console.log = this.originalConsole.log;
      console.warn = this.originalConsole.warn;
      console.error = this.originalConsole.error;
      console.debug = this.originalConsole.debug;
      console.info = this.originalConsole.info;
      this.originalConsole = null;
    }
    this.isInitialized = false;
  }
}

export const loggerService = new LoggerService();
