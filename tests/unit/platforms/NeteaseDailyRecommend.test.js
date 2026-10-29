const recommendSongs = require('../../../platforms/netease/module/recommend_songs')

describe('网易云每日推荐', () => {
  let warn
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warn.mockRestore() })
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

  test('Web 接口仍不完整时读取手机接口，保留账号凭据并不刷新日推', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ body: shortList })
      .mockResolvedValueOnce({ body: shortList })
      .mockResolvedValueOnce({ body: fullList })
    expect(await recommendSongs({ MUSIC_U: 'private-cookie' }, request)).toBe(fullList)
    expect(request).toHaveBeenLastCalledWith('/api/v3/discovery/recommend/songs',
      { ispush: false }, { crypto: 'xeapi', useCheckToken: false, MUSIC_U: 'private-cookie' })
    expect(warn).not.toHaveBeenCalled()
  })

  test('备用请求失败或更短时保留最长列表，日志不泄漏上游凭据', async () => {
    const longer = { code: 200, data: { dailySongs: [{ id: 1 }, { id: 2 }, { id: 3 }] } }
    const request = jest.fn()
      .mockResolvedValueOnce({ body: shortList })
      .mockResolvedValueOnce({ body: longer })
      .mockRejectedValueOnce({ status: 403, message: 'private-cookie', body: { cookie: 'private-cookie' } })
    expect(await recommendSongs({ MUSIC_U: 'private-cookie' }, request)).toBe(longer)
    expect(JSON.stringify(warn.mock.calls)).toContain('403')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-cookie')
  })
})
