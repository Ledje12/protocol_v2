// Le néon d'ouverture (index.html) s'efface quand un vrai écran est
// prêt et que la mise à jour éventuelle a été vérifiée : l'app ne
// le prévient que pour la mise à jour.

export function splashUpdateChecked() {
  window.__protocolSplash?.updateChecked();
}

export function splashGone() {
  return !window.__protocolSplash || window.__protocolSplash.isGone();
}
