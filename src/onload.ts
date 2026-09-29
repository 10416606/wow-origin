import { QQClient } from './clients/QQClient';
import { NeteaseClient } from './clients/NeteaseClient';
import type { AccountSessionRegistry, MusicAccountSession } from './accounts';
import type { LxSourceLifecycle } from './lx-resource';

export async function preloadSessionFavorites(session: MusicAccountSession): Promise<void> {
  if (!session.cookie.trim()) return;
  const client = session.platform === 'netease'
    ? new NeteaseClient(session.cookie, session.favoriteTrackIds, session.favoriteArtistIds, session.favoriteAlbumIds, session.userPlaylistIds)
    : new QQClient(session.cookie, session.favoriteTrackIds, session.favoriteArtistIds, session.favoriteAlbumIds, session.userPlaylistIds);

  for (const [label, load, markLoaded] of [
    ['tracks', () => client.userFavoriteTracks(), () => {}],
    ['artists', () => client.userArtists(), () => { session.favoriteArtistsLoaded = true; }],
    ['albums', () => client.userAlbums(), () => { session.favoriteAlbumsLoaded = true; }]
  ] as const) {
    try {
      const items = await load();
      markLoaded();
      console.log(`[onload] preloaded ${items.length} ${session.platform} favorite ${label} for ${session.name}`);
    } catch (error) {
      console.warn(`[onload] failed to preload ${session.platform} favorite ${label} for ${session.name}: ${(error as Error).message}`);
    }
  }
}

export async function preloadData(
  _platformFactory: any,
  registry?: AccountSessionRegistry,
  lxSourceLifecycle?: LxSourceLifecycle
): Promise<void> {
  // 洛雪源必须后台加载，不能延迟 HTTP 服务启动。
  lxSourceLifecycle?.start();

  for (const session of registry?.sessions || []) {
    await preloadSessionFavorites(session);
  }
}
