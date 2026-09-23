import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getLatestBackup, getBackupHistory, restoreFromBackup } from '../lib/db';

interface Props { children: ReactNode }
interface State { error: Error | null; info: ErrorInfo | null }

// This is the single most important UI rule carried over from the old app's
// spec: "If the app fails to render, show a visible Recovery Mode instead of
// a blank page." A React error boundary is the only reliable way to
// guarantee that at the framework level — no code path below this component
// can produce a blank white screen; the worst case is this screen.
export class RecoveryBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PropertyWorks crashed — showing Recovery Mode:', error, info);
    this.setState({ error, info });
  }

  handleRestoreLatest = async () => {
    const backup = getLatestBackup();
    if (backup) {
      await restoreFromBackup(backup);
      window.location.reload();
    }
  };

  handleReload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    const hasBackup = Boolean(getLatestBackup());
    const history = getBackupHistory();

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            <h1 className="text-xl font-semibold">Recovery Mode</h1>
          </div>
          <p className="text-slate-300 text-sm">
            PropertyWorks hit an error and stopped instead of showing a blank
            screen. Your data is safe in this browser — nothing local has
            been cleared.
          </p>
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs font-mono text-rose-300 overflow-auto max-h-40">
            {this.state.error.message}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={this.handleReload}
              className="w-full rounded-md bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-medium"
            >
              Reload the app
            </button>
            {hasBackup && (
              <button
                onClick={this.handleRestoreLatest}
                className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium"
              >
                Restore latest local backup &amp; reload
              </button>
            )}
          </div>
          {history.length > 0 && (
            <p className="text-xs text-slate-500">
              {history.length} rolling local backup{history.length === 1 ? '' : 's'} available in this browser.
            </p>
          )}
        </div>
      </div>
    );
  }
}
