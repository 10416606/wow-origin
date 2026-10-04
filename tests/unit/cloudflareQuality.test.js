jest.mock('../../cloudflare/generated/lx-source', () => ({
  bundledLxSource: { enabled: true },
  installBundledLxSource: ({ lx }) => {
    lx.on('request', (request) => global.lxQualityHandler(request))
    lx.send('inited', { sources: { tx: { actions: ['musicUrl'], qualitys: global.lxCapabilities || ['128k', '320k', 'flac', 'flac24bit', 'hires', 'master'] } } })
  }
}))
const { CloudflareLxSourceManager } = require('../../cloudflare/lx-manager')

describe('Cloudflare extended LX quality', () => {
  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('metadata unavailable')) })
  afterEach(() => { delete global.lxQualityHandler; delete global.lxCapabilities; jest.useRealTimers(); jest.restoreAllMocks() })
  test('automatic fallback skips spatial audio while an explicit sky request uses it', async () => {
    global.lxCapabilities = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master']
    global.lxQualityHandler = jest.fn().mockImplementation(({ info }) =>
      info.type === 'master' ? Promise.reject(new Error('unavailable')) : Promise.resolve('https://audio.test/' + info.type))
    const manager = new CloudflareLxSourceManager()
    await expect(manager.resolveTrackUrl('qq', 'song', 'max')).resolves.toMatchObject({ quality: 'hires' })
    expect(global.lxQualityHandler.mock.calls.map(([request]) => request.info.type)).toEqual(['master', 'hires'])

    global.lxQualityHandler.mockClear()
    await expect(manager.resolveTrackUrl('qq', 'song', 'sky')).resolves.toMatchObject({ quality: 'sky' })
    expect(global.lxQualityHandler.mock.calls.map(([request]) => request.info.type)).toEqual(['atmos'])
  })
  test('QQ catalogue supplies matching master size when CDN GET and HEAD are denied', async () => {
    global.lxQualityHandler = jest.fn().mockImplementation(({ info }) => info.type === 'master'
      ? Promise.resolve('https://aqqmusic.tc.qq.com/AI00example.flac?vkey=test') : Promise.reject(new Error('unavailable')))
    global.fetch.mockImplementation(async (url) => url === 'https://u.y.qq.com/cgi-bin/musicu.fcg'
      ? Response.json({ req: { data: { track_info: { mid: 'song', file: { size_flac: 73008761, size_new: [227033211] } } } } })
      : new Response('', { status: 403 }))
    const manager = new CloudflareLxSourceManager()
    expect(await manager.getTrackQualities('qq', 'song')).toEqual([
      { key: 'master', label: '母带', size: 227033211, format: 'flac', bitrate: null }
    ])
    expect(await manager.resolveTrackUrl('qq', 'song', 'master')).toMatchObject({ quality: 'master', size: 227033211, format: 'flac' })
    expect(global.fetch.mock.calls.filter(([url]) => url === 'https://u.y.qq.com/cgi-bin/musicu.fcg')).toHaveLength(1)
  })
  test('unknown files never borrow the catalogue master size', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://aqqmusic.tc.qq.com/F000example.flac')
    global.fetch.mockResolvedValue(new Response('', { status: 403 }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')).toMatchObject({ size: 0 })
    expect(global.fetch.mock.calls.every(([url]) => url !== 'https://u.y.qq.com/cgi-bin/musicu.fcg')).toBe(true)
  })
  test('size from the returned audio takes precedence over catalogue size', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://aqqmusic.tc.qq.com/AI00example.flac')
    global.fetch.mockImplementation(async (url) => url === 'https://u.y.qq.com/cgi-bin/musicu.fcg'
      ? Response.json({ req: { data: { track_info: { mid: 'song', file: { size_new: [227033211] } } } } })
      : new Response('fLaC', { status: 206, headers: { 'content-range': 'bytes 0-3/123456' } }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')).toMatchObject({ size: 123456 })
  })
  test('catalogue for a different song is not used', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://aqqmusic.tc.qq.com/AI00example.flac')
    global.fetch.mockImplementation(async (url) => url === 'https://u.y.qq.com/cgi-bin/musicu.fcg'
      ? Response.json({ req: { data: { track_info: { mid: 'another', file: { size_new: [227033211] } } } } })
      : new Response('', { status: 403 }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')).toMatchObject({ size: 0 })
  })
  test('track qualities report exact-tier size and omit unavailable master without downgrading', async () => {
    global.lxQualityHandler = jest.fn().mockImplementation(({ info }) => info.type === 'master'
      ? Promise.reject(new Error('unavailable')) : Promise.resolve('https://audio.test/' + info.type))
    global.fetch.mockImplementation(async () => new Response('fLaC', {
      status: 206, headers: { 'content-range': 'bytes 0-3/123456' }
    }))
    const qualities = await new CloudflareLxSourceManager().getTrackQualities('qq', 'song')
    expect(qualities.map(q => q.key)).toEqual(['flac24bit', 'hires'])
    expect(qualities.every(q => q.size === 123456)).toBe(true)
    expect(global.lxQualityHandler.mock.calls.map(([r]) => r.info.type)).toEqual(['flac24bit', 'hires', 'master'])
  })
  test('advertises declared master capability and passes master to source', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/master.flac')
    const manager = new CloudflareLxSourceManager()
    expect(manager.getQualityOptions('qq')).toContainEqual({ key: 'master', label: '母带' })
    expect(manager.getQualityOptions('netease')).toEqual([])
    expect(await manager.resolveTrackUrl('qq', 'song', 'master')).toMatchObject({ quality: 'master' })
    expect(global.lxQualityHandler.mock.calls[0][0].info.type).toBe('master')
  })
  test('failed master falls back and reports actual selected quality', async () => {
    global.lxQualityHandler = jest.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue('https://audio.test/hires.flac')
    const result = await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')
    expect(result.quality).toBe('hires')
    expect(global.lxQualityHandler.mock.calls.map(([request]) => request.info.type)).toEqual(['master', 'hires'])
  })
  test('SQ remains SQ and never requests higher tiers', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/sq.flac')
    expect((await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'lossless')).quality).toBe('lossless')
    expect(global.lxQualityHandler.mock.calls[0][0].info.type).toBe('flac')
  })
  test('auto selects master and reads real size and average FLAC bitrate', async () => {
    const header = Buffer.alloc(42)
    header.write('fLaC'); header[7] = 34
    header.writeBigUInt64BE((192000n << 44n) | (1n << 41n) | (23n << 36n) | 1920000n, 18)
    global.fetch.mockResolvedValue(new Response(header, { status: 206,
      headers: { 'content-range': 'bytes 0-41/10000000', 'content-length': '42', 'content-type': 'audio/flac' } }))
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/master.flac')
    const manager = new CloudflareLxSourceManager()
    expect(manager.getQualityOptions('qq')).toContainEqual({ key: 'max', label: '自动最高音质（失败逐级降级）' })
    expect(await manager.resolveTrackUrl('qq', 'song', 'max')).toMatchObject({
      quality: 'master', size: 10000000, format: 'flac', bitrate: 8000000
    })
  })
  test('a partial response length is not mistaken for full file size', async () => {
    global.fetch.mockResolvedValue(new Response('ID3', { status: 206, headers: { 'content-length': '3' } }))
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/song')
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'exhigh'))
      .toMatchObject({ size: 0, format: 'mp3' })
  })
  test('unplayable master URL falls back to Hi-Res', async () => {
    global.fetch.mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('fLaC', { headers: { 'content-length': '8000' } }))
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/song')
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'max'))
      .toMatchObject({ quality: 'hires', size: 8000 })
  })
  test('a stalled master request leaves time for the next tier', async () => {
    jest.useFakeTimers()
    global.lxQualityHandler = jest.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue('https://audio.test/hires.flac')
    const pending = new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'max')
    await jest.advanceTimersByTimeAsync(8001)
    expect(await pending).toMatchObject({ quality: 'hires' })
  })
  test('a server ignoring Range is cancelled after the header', async () => {
    const cancel = jest.fn()
    global.fetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4096)) }, cancel
    }), { headers: { 'content-length': '12345678' } }))
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/song')
    expect((await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'max')).size).toBe(12345678)
    expect(cancel).toHaveBeenCalled()
  })
  test('QQ IP links keep their playback URL while metadata uses the domain route', async () => {
    const url = 'http://203.0.113.1/amobile.music.tc.qq.com/AI001test.flac?vkey=test'
    global.lxQualityHandler = jest.fn().mockResolvedValue(url)
    global.fetch.mockResolvedValue(new Response('fLaC', { status: 206,
      headers: { 'content-range': 'bytes 0-3/227033211' } }))
    const result = await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')
    expect(result).toMatchObject({ url, quality: 'master', size: 227033211 })
    expect(global.fetch.mock.calls[0][0]).toBe('https://aqqmusic.tc.qq.com/AI001test.flac?vkey=test')
  })
  test('a failed IP metadata alternative does not falsely downgrade master', async () => {
    const url = 'http://203.0.113.1/amobile.music.tc.qq.com/AI001test.flac?vkey=test'
    global.lxQualityHandler = jest.fn().mockResolvedValue(url)
    global.fetch.mockResolvedValue(new Response('', { status: 403 }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master'))
      .toMatchObject({ url, quality: 'master', size: 0 })
    expect(global.lxQualityHandler).toHaveBeenCalledTimes(1)
  })
  test('unknown literal IPs are preserved without unsupported Worker fetches', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('http://[2001:db8::1]/song.flac')
    expect((await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')).quality).toBe('master')
    expect(global.fetch).not.toHaveBeenCalled()
  })
  test('QQ domain audio uses HTTPS and preserves the signed path and query', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('http://aqqmusic.tc.qq.com/AI001test.flac?vkey=test&uin=123')
    global.fetch.mockResolvedValue(new Response('fLaC', { status: 206,
      headers: { 'content-range': 'bytes 0-3/227033211' } }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master'))
      .toMatchObject({ url: 'https://aqqmusic.tc.qq.com/AI001test.flac?vkey=test&uin=123', quality: 'master', size: 227033211 })
  })
  test('CDN rejection of Worker metadata does not prove the client cannot play', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValue('https://audio.test/master.flac')
    global.fetch.mockResolvedValue(new Response('', { status: 403 }))
    expect(await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master'))
      .toMatchObject({ quality: 'master', size: 0 })
    expect(global.lxQualityHandler).toHaveBeenCalledTimes(1)
  })
  test('empty QQ CDN directory is rejected before probing and falls back', async () => {
    global.lxQualityHandler = jest.fn().mockResolvedValueOnce('https://aqqmusic.tc.qq.com/')
      .mockResolvedValue('https://audio.test/hires.flac')
    expect((await new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')).quality).toBe('hires')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
  test('source response after five seconds is accepted instead of prematurely downgraded', async () => {
    jest.useFakeTimers()
    global.lxQualityHandler = jest.fn().mockImplementation(() => new Promise(resolve =>
      setTimeout(() => resolve('https://audio.test/master.flac'), 5000)))
    const pending = new CloudflareLxSourceManager().resolveTrackUrl('qq', 'song', 'master')
    await jest.advanceTimersByTimeAsync(5001)
    expect((await pending).quality).toBe('master')
    expect(global.lxQualityHandler).toHaveBeenCalledTimes(1)
  })
})
