import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
          background: '#14639c', color: 'white', fontFamily: 'system-ui, sans-serif', textAlign: 'center'
        }}>
          <div style={{ maxWidth: 420 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 16 }}>
              {this.state.error.message || 'The app hit an unexpected error.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'white', color: '#14639c', border: 'none', borderRadius: 999,
                padding: '10px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
