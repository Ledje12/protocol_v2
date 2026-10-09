import BrandMark from "./BrandMark.jsx";
import StateScreen from "./StateScreen.jsx";

export function AppLoadingScreen() {
  return (
    <main
      className="protocol-auth-page protocol-loading-page"
      aria-busy="true"
    >
      <div className="protocol-auth-glow" />

      <section className="protocol-loading">
        <BrandMark size="lg" />

        <span
          className="protocol-diamond protocol-loading-diamond"
          aria-hidden="true"
        />

        <p>
          Un instant.
        </p>
      </section>
    </main>
  );
}

export default function LoadingScreen() {
  return (
    <StateScreen
      kind="loading"
      text="Préparation…"
    />
  );
}
