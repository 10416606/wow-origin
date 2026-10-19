const { NeteaseClient } = require('../../../dist/clients/NeteaseClient');
const { QQClient } = require('../../../dist/clients/QQClient');
const { PlaylistFavorites } = require('../../../dist/playlistFavorites');

const playlist = (id, favorite) => ({ id, name: id, favorite, description: '', coverUrl: '', trackCount: 0 });

describe('account playlist favorites', () => {
  afterEach(() => { delete global.__musicPlatformFactory__; });

  test('full snapshots replace saved IDs, preserve own false, and remain account isolated', () => {
    const first = new PlaylistFavorites();
    const second = new PlaylistFavorites();
    first.replace([playlist('own', false), playlist('saved', true)]);
    expect(first.apply(playlist('own', true), true).favorite).toBe(false);
    expect(first.apply(playlist('saved', false)).favorite).toBe(true);
    expect(second.apply(playlist('saved', true)).favorite).toBe(false);
    first.replace([playlist('other', true)]);
    expect(first.apply(playlist('saved', true)).favorite).toBe(false);
    expect(first.apply(playlist('other', false), false).favorite).toBe(false);
    first.set('other', true);
    expect(first.apply(playlist('other', false)).favorite).toBe(true);
    first.clear();
    expect(first.loaded).toBe(false);
    expect(first.apply(playlist('other', true)).favorite).toBe(false);
  });

  test.each([
    ['Netease', NeteaseClient, 'MUSIC_U=cookie'],
    ['QQ', QQClient, 'uin=o1; qm_keyst=cookie']
  ])('%s rebuilds list state and shares confirmed mutations across requests', async (_, Client, cookie) => {
    let saved = true;
    let fail = false;
    global.__musicPlatformFactory__ = { getPlatform: () => ({ callModule: jest.fn(async (route) => {
      if (route === 'user/playlist') return { code: 200, playlist: [
        { id: 'own', name: 'Own', subscribed: false, creator: { userId: '1' } },
        ...(saved ? [{ id: 'saved', name: 'Saved', subscribed: true, creator: { userId: '2' } }] : [])
      ] };
      if (route === 'playlist/detail') return { code: 200, playlist: { id: 'saved', name: 'Saved', tracks: [] } };
      if (route === 'playlist/subscribe') return fail ? { code: 200, body: { code: 501, retCode: 1 } } : { code: 200 };
      if (route === 'search') return { code: 200, result: { playlists: [{ id: 'saved', name: 'Saved' }] } };
      return { code: 200 };
    }) }) };
    const state = new PlaylistFavorites();
    const first = new Client(cookie);
    first.playlistFavorites = state;
    expect((await first.getUserPlaylist()).map(p => p.favorite)).toEqual([false, true]);
    const next = new Client(cookie);
    next.playlistFavorites = state;
    expect((await next.getPlaylistDetail('saved', 0)).favorite).toBe(true);
    await expect(first.favoritePlaylist('saved', false)).resolves.toMatchObject({ success: true, status: false });
    expect((await next.getPlaylistDetail('saved', 0)).favorite).toBe(false);
    fail = true;
    await expect(first.favoritePlaylist('saved', true)).resolves.toMatchObject({ success: false });
    expect((await next.getPlaylistDetail('saved', 0)).favorite).toBe(false);
    saved = false;
    await first.getUserPlaylist();
    expect(state.apply(playlist('saved', true)).favorite).toBe(false);
  });
});
