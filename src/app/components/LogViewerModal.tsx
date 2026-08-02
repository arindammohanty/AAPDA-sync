import { useEffect, useState } from 'react';
import { logger, type LogEntry } from '../../webfunctions/diagnostics/logger';

interface LogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LogViewerModal({ isOpen, onClose }: LogViewerModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLogs(logger.getLogs());

    const unsubscribe = logger.subscribe(() => {
      setLogs(logger.getLogs());
    });

    return () => unsubscribe();
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter(l => {
    if (filterLevel !== 'ALL' && l.level !== filterLevel) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchCategory = l.category.toLowerCase().includes(q);
      const matchMsg = l.message.toLowerCase().includes(q);
      const matchDetails = l.details ? JSON.stringify(l.details).toLowerCase().includes(q) : false;
      return matchCategory || matchMsg || matchDetails;
    }
    return true;
  }).reverse();

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-100">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gray-900 text-white flex items-center justify-between border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold tracking-wide">System Diagnostic Logs</h2>
              <p className="text-xs text-gray-400">Offline Event Trace & Worker Diagnostics</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                logger.clear();
                setLogs([]);
              }}
              className="bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-red-500/20 flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear Log History
            </button>

            <button
              onClick={() => logger.downloadLogFile()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export .log File
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar Filters */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
            {(['ALL', 'INFO', 'WARN', 'ERROR'] as const).map(lvl => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${filterLevel === lvl ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => logger.clear()}
            className="text-xs font-semibold text-red-600 hover:text-red-700 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
          >
            Clear Log Storage
          </button>
        </div>

        {/* Log Entries View */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-xs space-y-2.5 bg-gray-950 text-gray-200">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-gray-500 font-sans">
              No diagnostic log entries match your filter.
            </div>
          ) : (
            filteredLogs.map(l => {
              let badgeColor = 'bg-blue-900/40 text-blue-400 border-blue-800/50';
              if (l.level === 'WARN') badgeColor = 'bg-amber-900/40 text-amber-400 border-amber-800/50';
              if (l.level === 'ERROR') badgeColor = 'bg-red-900/40 text-red-400 border-red-800/50';

              return (
                <div key={l.id} className="p-3 bg-gray-900/90 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}>
                        {l.level}
                      </span>
                      <span className="text-emerald-400 font-bold">[{l.category}]</span>
                      <span className="text-gray-300 font-semibold">{l.message}</span>
                    </div>
                    <span className="text-[10px] text-gray-500 font-sans">
                      {new Date(l.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {l.details && (
                    <pre className="mt-1.5 p-2 bg-gray-950 rounded text-[11px] text-gray-400 overflow-x-auto border border-gray-900/80">
                      {typeof l.details === 'string' ? l.details : JSON.stringify(l.details, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <span>Total Entries: <strong>{filteredLogs.length}</strong></span>
          <span>AAPDA-sync Resilient Offline Diagnostic Engine</span>
        </div>

      </div>
    </div>
  );
}
