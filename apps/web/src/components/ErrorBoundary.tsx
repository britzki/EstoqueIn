import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, EmptyState } from './ui';

/** Evita tela em branco: se uma página quebrar, mostra uma mensagem e mantém o menu funcionando. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        icon={<TriangleAlert />}
        title="Algo deu errado nesta página"
        description={this.state.error.message}
        action={<Button onClick={() => this.setState({ error: null })}>Tentar novamente</Button>}
      />
    );
  }
}
