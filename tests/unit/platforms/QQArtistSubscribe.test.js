const artistSubscribe = require('../../../platforms/qqmusic/module/artist_sub')

test.each([
  [true, 0],
  [false, 1]
])('QQ 艺人收藏状态 %s 使用新版关注接口', async (status, opertype) => {
  const request = jest.fn().mockResolvedValue({ body: {
    code: 0, req_0: { code: 0, data: { code: 0 } }
  } })

  await expect(artistSubscribe({ id: 'artist-mid', t: status ? 1 : 0, uin: '42', qm_keyst: 'key' }, request))
    .resolves.toEqual({ retCode: 0 })
  expect(request).toHaveBeenCalledWith(
    'music.concern.ConcernSystem',
    'cgi_concern_user_v2',
    {
      bussinesstype: '', source: 137, opertype, bussinessid: '',
      userinfo: { usertype: 1, userid: 'artist-mid' }
    },
    expect.objectContaining({
      uin: '42', qm_keyst: 'key', transport: 'plain', keepEnvelope: true,
      webCgiKey: 'cgi_concern_user_v2',
      comm: expect.objectContaining({ ct: 23, cv: 0, platform: 'h5', mesh_devops: 'DevopsBase' })
    })
  )
})

test('QQ 艺人旧接口式外层成功但内部失败不能视为收藏成功', async () => {
  const request = jest.fn().mockResolvedValue({ body: { code: 0, req_0: { code: 1000 } } })
  await expect(artistSubscribe({ id: 'artist-mid', t: 1, uin: '42', qm_keyst: 'key' }, request))
    .resolves.toEqual({ retCode: 1000 })
})
