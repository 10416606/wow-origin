import type { ResolveWowContext, TrackUrl } from 'aduoer-wow-sdk';
import { type AccountSessionRegistry, type MusicAccountSession, extractAuthorizationToken } from './accounts';
import { NeteaseClient } from './clients/NeteaseClient';
import { QQClient } from './clients/QQClient';
import { getQualityOptions } from './quality';
import { collectionStatusNeeded } from './collectionStatus';
import type { MusicPlatform } from './types';
import type { LxTrackUrlResolver } from './lx-resource';

/** 根据私有平台账号创建符合公开 SDK 契约的 Adapter。 */
export function createMusicClient(
  platform: MusicPlatform,
  cookie: string,
  favoriteTrackIds?: Set<string>,
  favoriteArtistIds?: Set<string>,
  favoriteAlbumIds?: Set<string>,
  userPlaylistIds?: Set<string>
): QQClient | NeteaseClient {
  return platform === 'qq'
    ? new QQClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds)
    : new NeteaseClient(cookie, favoriteTrackIds, favoriteArtistIds, favoriteAlbumIds, userPlaylistIds);
}

function hasValidAudioUrl(trackUrl: TrackUrl | undefined): trackUrl is TrackUrl {
  if (!trackUrl || typeof trackUrl.url !== 'string' || !trackUrl.url.trim()) return false;
  try {
    const url = new URL(trackUrl.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createAdapter(
  account: MusicAccountSession,
  lxTrackUrlResolver?: LxTrackUrlResolver
): QQClient | NeteaseClient {
  const client = createMusicClient(account.platform, account.cookie, account.favoriteTrackIds, account.favoriteArtistIds, account.favoriteAlbumIds, account.userPlaylistIds);
  const userArtists = client.userArtists.bind(client);
  client.userArtists = async () => {
    const artists = await userArtists();
    account.favoriteArtistsLoaded = true;
    return artists;
  };
  const userAlbums = client.userAlbums.bind(client);
  client.userAlbums = async () => {
    const albums = await userAlbums();
    account.favoriteAlbumsLoaded = true;
    return albums;
  };
  if (account.useLuoxue === false || !lxTrackUrlResolver) return client;

  const defaultGetTrackUrl = client.getTrackUrl.bind(client);
  const getLxTrackUrl = async (id: string, quality?: string): Promise<TrackUrl | undefined> => {
    try {
      const lxTrackUrl = account.lxSource?.length
        ? await lxTrackUrlResolver.resolveTrackUrl(account.platform, id, quality, account.lxSource)
        : await lxTrackUrlResolver.resolveTrackUrl(account.platform, id, quality);
      if (hasValidAudioUrl(lxTrackUrl)) return lxTrackUrl;
      if (lxTrackUrl) {
        console.warn('[lx-source] resolver returned an invalid audio URL, using official track URL flow');
      }
    } catch {
      console.warn('[lx-source] unexpected resolver failure, using official track URL flow');
    }
    return undefined;
  };

  client.getTrackUrl = async (id: string, quality?: string) => {
    const lxTrackUrl = await getLxTrackUrl(id, quality);
    if (lxTrackUrl) return lxTrackUrl;
    return defaultGetTrackUrl(id, quality);
  };
  return client;
}

/** 将账号鉴权和 Adapter 选择接入 SDK；协议路由及响应校验由 SDK 负责。 */
export function createWowContextResolver(
  registry: AccountSessionRegistry,
  lxTrackUrlResolver?: LxTrackUrlResolver
): ResolveWowContext {
  return async ({ authorization, request }) => {
    const token = extractAuthorizationToken(authorization);
    const account = token ? registry.byAccessKey.get(token) : undefined;
    if (!account) return null;

    const adapter = createAdapter(account, lxTrackUrlResolver);
    const needed = collectionStatusNeeded(request?.path || '');
    if (needed.artists && !account.favoriteArtistsLoaded) {
      try {
        await adapter.userArtists();
        account.favoriteArtistsLoaded = true;
      } catch {
        // 保留已有集合；下一次需要状态时重试。
      }
    }
    if (needed.albums && !account.favoriteAlbumsLoaded) {
      try {
        await adapter.userAlbums();
        account.favoriteAlbumsLoaded = true;
      } catch {
        // 保留已有集合；下一次需要状态时重试。
      }
    }
    return {
      adapter,
      qualityMap: getQualityOptions(account.platform),
      accountName: account.name,
      stateless: account.stateless
    };
  };
}
