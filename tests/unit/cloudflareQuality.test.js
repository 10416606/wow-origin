jest.mock('../../cloudflare/generated/lx-source', () => ({
  bundledLxSource: { enabled: true },
  installBundledLxSource: ({ lx }) => {
    lx.on('request', (request) => global.lxQualityHandler(request))
    lx.send('inited', { sources: { tx: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'master'] } } })
  }
}))
const { CloudflareLxSourceManager } = require('../../cloudflare/lx-manager')

describe('Cloudflare extended LX quality', () => {
  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('metadata unavailable')) })
  afterEach(() => { delete global.lxQualityHandler; jest.useRealTimers(); jest.restoreAllMocks() })
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
    global.fetch.mockResolvedValueOnce(new Response('', { status: 403 }))
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
    await jest.advanceTimersByTimeAsync(3501)
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
})
