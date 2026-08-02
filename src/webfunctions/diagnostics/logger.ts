export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  category: string;
  message: string;
  details?: any;
}

const STORAGE_KEY = 'aapdasync_system_logs_v1';
const MAX_LOGS = 500;

class SystemLogger {
  private logs: LogEntry[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
    this.setupGlobalHandlers();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      this.logs = [];
    }
  }

  private saveToStorage() {
    try {
      if (this.logs.length > MAX_LOGS) {
        this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch (e) {
      // Storage quota reached, truncate aggressively
      this.logs = this.logs.slice(-100);
    }
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(fn => fn());
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setupGlobalHandlers() {
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.error('SYSTEM_CRASH', event.message || 'Uncaught Window Error', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.error('PROMISE_REJECTION', event.reason?.message || String(event.reason), {
          reason: event.reason,
          stack: event.reason?.stack
        });
      });
    }
  }

  public info(category: string, message: string, details?: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level: 'INFO',
      category,
      message,
      details
    };
    console.log(`[${entry.timestamp}] [INFO] [${category}] ${message}`, details || '');
    this.logs.push(entry);
    this.saveToStorage();
  }

  public warn(category: string, message: string, details?: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level: 'WARN',
      category,
      message,
      details
    };
    console.warn(`[${entry.timestamp}] [WARN] [${category}] ${message}`, details || '');
    this.logs.push(entry);
    this.saveToStorage();
  }

  public error(category: string, message: string, details?: any) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      category,
      message,
      details
    };
    console.error(`[${entry.timestamp}] [ERROR] [${category}] ${message}`, details || '');
    this.logs.push(entry);
    this.saveToStorage();
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    this.notifyListeners();
  }

  public downloadLogFile() {
    const textContent = this.logs
      .map(l => `[${l.timestamp}] [${l.level}] [${l.category}] ${l.message} ${l.details ? JSON.stringify(l.details) : ''}`)
      .join('\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aapdasync_debug_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const logger = new SystemLogger();
