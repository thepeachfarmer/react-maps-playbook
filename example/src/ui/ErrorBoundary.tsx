import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Without this, a render error in an installed PWA is a blank screen with no
 * Back button. Full-screen card at z 2000.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>The map hit an error. Reloading usually fixes it.</p>
          <button type="button" className="btn-primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
