import { Component, type ErrorInfo, type ReactNode } from "react";

type ShellErrorBoundaryProps = {
  children: ReactNode;
};

type ShellErrorBoundaryState = {
  hasError: boolean;
};

export class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Shell runtime failure", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="shell-loading-state">
        <div className="empty-state shell-error-state">
          <strong>We hit a local runtime issue.</strong>
          <span>The shell stayed alive. Reload this workspace to recover the current session cleanly.</span>
          <button className="action-primary-button" onClick={this.handleReload} type="button">
            Reload workspace
          </button>
        </div>
      </div>
    );
  }
}
