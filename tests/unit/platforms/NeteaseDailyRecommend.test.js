const recommendSongs = require('../../../platforms/netease/module/recommend_songs')

describe('网易云每日推荐', () => {
  const shortList = { code: 200, data: { dailySongs: [{ id: 1 }, { id: 2 }] } }
  const fullList = { code: 200, data: { dailySongs: Array.from({ length: 30 }, (_, i) => ({ id: i + 1 })) } }

  test('旧接口只返回两首时使用完整的 Web 推荐', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ body: shortList })
      .mockResolvedValueOnce({ body: fullList })

    expect(await recommendSongs({ MUSIC_U: 'private-cookie' }, request)).toBe(fullList)
    expect(request).toHaveBeenNthCalledWith(2,
      '/api/v3/discovery/recommend/songs',
      { afresh: false },
      { crypto: 'weapi', useCheckToken: false, MUSIC_U: 'private-cookie' }
    )
  })

  test('旧接口完整时不重复请求；备用接口失败时保留已有歌曲', async () => {
    const complete = jest.fn().mockResolvedValue({ body: fullList })
    expect(await recommendSongs({}, complete)).toBe(fullList)
    expect(complete).toHaveBeenCalledTimes(1)

    const unavailable = jest.fn()
      .mockResolvedValueOnce({ body: shortList })
      .mockRejectedValueOnce(new Error('upstream unavailable'))
    expect(await recommendSongs({}, unavailable)).toBe(shortList)
  })
})
