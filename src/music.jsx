/* Ambiance : une simple invitation vers une playlist Spotify publique.
   Pas d'API Spotify (accès développeur trop restreint) : un lien,
   qui ouvre l'app Spotify ; la musique continue quand on revient. */

// lien de partage de la playlist (open.spotify.com/playlist/…)
export const PLAYLIST_URL = "https://open.spotify.com/playlist/4we1AbznqBDBQKxcuJ24sf";

export const hasPlaylist = () => PLAYLIST_URL.startsWith("https://");

export function MusicNote({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 18.5a2.5 2.5 0 1 1-2.5-2.5c.9 0 1.7.4 2.2 1V5.2l11-2.2v13a2.5 2.5 0 1 1-2.5-2.5c.9 0 1.7.4 2.2 1V7.1L9 8.9z"
      />
    </svg>
  );
}

/* pastille discrète de l'écran de jeu */
export function MusicPill() {
  if (!hasPlaylist()) return null;
  return (
    <a
      className="music-pill"
      href={PLAYLIST_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Ouvrir la playlist dans Spotify"
    >
      <MusicNote size={13} />
      <span>Spotify</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}
