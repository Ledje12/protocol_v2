import { Component } from "react";

import { reportError } from "./errorLog.js";

// Si un écran plante, on affiche une sortie de secours au lieu
// d'une page noire, et l'erreur part au journal.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError("crash", {
      message: error?.message || String(error),
      stack: `${error?.stack || ""}\n--- composants ---${info?.componentStack || ""}`,
    });
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="app-crash" role="alert">
        <span className="protocol-diamond" aria-hidden="true" />
        <p className="kicker">PETIT ACCROC</p>
        <h1>Quelque chose a coincé.</h1>
        <p>
          L’erreur a été notée. Votre partie est enregistrée : en
          rechargeant, vous la retrouvez là où vous en étiez.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => window.location.reload()}
        >
          <span>Recharger</span>
          <span aria-hidden="true">↻</span>
        </button>
        <a href="/">Retour à l’accueil</a>
      </main>
    );
  }
}
