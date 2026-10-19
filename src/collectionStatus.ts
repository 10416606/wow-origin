/** 只有返回收藏状态的路由才需要加载账号的收藏 ID。 */
export function collectionStatusNeeded(path: string): { artists: boolean; albums: boolean; playlists: boolean } {
  return {
    playlists: ['/playlist/list', '/playlist/detail', '/playlist/recommended', '/search/playlists', '/toplist/detail'].includes(path),
    artists: ['/artist/top', '/artist/detail', '/album/detail', '/search/suggest', '/search/artists'].includes(path),
    albums: ['/artist/albums', '/album/detail', '/search/suggest', '/search/albums'].includes(path)
  };
}
