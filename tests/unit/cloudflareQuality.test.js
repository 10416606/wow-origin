jest.mock('../../cloudflare/generated/lx-source', () => ({
  bundledLxSource: { enabled: true },
  installBundledLxSource: ({ lx }) => {
    lx.on('request', (request) => global.lxQualityHandler(request))
    lx.send('inited', { sources: { tx: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'master'] } } })
  }
}))
const { CloudflareLxSourceManager } = require('../../cloudflare/lx-manager')

describe('Cloudflare extended LX quality', () => {
  afterEach(() => { delete global.lxQualityHandler })
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
})
