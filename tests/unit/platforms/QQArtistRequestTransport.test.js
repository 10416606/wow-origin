jest.mock('axios', () => ({ default: jest.fn() }))
jest.mock('../../../platforms/qqmusic/util/crypto', () => ({
  zzcSign: () => 'signature',
  encryptRequest: jest.fn(),
  decryptResponse: jest.fn()
}))

const axios = require('axios').default
const { encryptRequest, decryptResponse } = require('../../../platforms/qqmusic/util/crypto')
const { createRequest } = require('../../../platforms/qqmusic/util/request')

test('QQ 艺人写入使用签名明文请求并保留内部响应码', async () => {
  axios.mockResolvedValue({ data: Buffer.from(JSON.stringify({
    code: 0, req_0: { code: 1000, data: { code: 0 } }
  })) })

  const response = await createRequest('music.concern.ConcernSystem', 'cgi_concern_user_v2',
    { opertype: 0 }, {
      uin: '42', qm_keyst: 'key', transport: 'plain', keepEnvelope: true,
      webCgiKey: 'cgi_concern_user_v2',
      comm: { ct: 23, cv: 0, platform: 'h5', mesh_devops: 'DevopsBase' }
    })

  expect(response.body.req_0.code).toBe(1000)
  const config = axios.mock.calls[0][0]
  expect(config.url).toContain('_webcgikey=cgi_concern_user_v2')
  expect(config.url).not.toContain('encoding=ag-1')
  expect(config.headers.Cookie).toBe('uin=o42; qm_keyst=key')
  expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  expect(JSON.parse(config.data)).toMatchObject({
    comm: { ct: 23, cv: 0, platform: 'h5', mesh_devops: 'DevopsBase' },
    req_0: { module: 'music.concern.ConcernSystem', method: 'cgi_concern_user_v2', param: { opertype: 0 } }
  })
  expect(encryptRequest).not.toHaveBeenCalled()
  expect(decryptResponse).not.toHaveBeenCalled()
})
