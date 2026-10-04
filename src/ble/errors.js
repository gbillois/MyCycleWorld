// Traduit les erreurs Web Bluetooth en messages compréhensibles (partagé par le diagnostic et le jeu).

export function explainError(e) {
  if (e?.name === 'NotFoundError' && /cancel/i.test(e.message)) return 'Sélection annulée.';
  if (e?.name === 'NotFoundError') return `Aucun appareil choisi (${e.message}).`;
  if (e?.name === 'SecurityError') return 'Bluetooth bloqué par le navigateur (page non sécurisée ou permission refusée).';
  if (e?.name === 'NotAllowedError') return 'Bluetooth refusé : autorise-le dans les réglages du navigateur (sur iPad : Réglages → Bluefy → Bluetooth).';
  if (e?.name === 'NetworkError') {
    return `Connexion impossible : l'appareil est peut-être déjà utilisé par une autre appli (Zwift ?). ${e.message || ''}`.trim();
  }
  return e?.message || String(e);
}
