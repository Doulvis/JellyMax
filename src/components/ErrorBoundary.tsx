import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface State {
  error: Error | null;
}

/** Dernier filet de sécurité : une erreur d'affichage ne laisse jamais un écran noir. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[JellyMax] Erreur d’affichage', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-state error-state--full">
        <h2>{t('eb.title')}</h2>
        <p>{this.state.error.message}</p>
        <div className="row">
          <button
            className="btn btn--primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.hash = '#/';
            }}
          >
            {t('eb.home')}
          </button>
          <button className="btn btn--ghost" onClick={() => window.location.reload()}>
            {t('eb.reload')}
          </button>
        </div>
      </div>
    );
  }
}
