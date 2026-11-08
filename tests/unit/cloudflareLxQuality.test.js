let mockKugouAlias = 'kg'
jest.mock('../../cloudflare/generated/lx-source', () => ({
  bundledLxSource: { enabled: true },
  installBundledLxSource: ({ lx }) => {
    lx.on(lx.EVENT_NAMES.request, async ({ source, info }) => {
      if (source === 'kg' || source === 'kugou') {
        if (source !== mockKugouAlias || info.musicInfo.hash !== 'a'.repeat(32) || info.musicInfo.source !== source) throw new Error('wrong Kugou payload')
        return `https://audio.test/${source}/${info.musicInfo.hash}/${info.type}`
      }
      if (info.type === 'flac') throw new Error('SQ unavailable')
      return `https://audio.test/${info.type}`
    })
    lx.send(lx.EVENT_NAMES.inited, { sources: {
      tx: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
      wy: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac'] },
      [mockKugouAlias]: { actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit'] }
    } })
  }
}), { virtual: true })

const { CloudflareLxSourceManager } = require('../../cloudflare/lx-manager')

beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('metadata unavailable')) })
afterEach(() => { jest.restoreAllMocks() })

test('Cloudflare 洛雪与本地流程一致，只请求指定音质，由外层按详情降级', async () => {
  const manager = new CloudflareLxSourceManager()
  const options = { allowFallback: false }
  await expect(manager.resolveTrackUrl('qq', 'track', 'lossless', [], options)).resolves.toBeUndefined()
  await expect(manager.resolveTrackUrl('netease', 'track', 'hires', [], options)).resolves.toBeUndefined()
  await expect(manager.resolveTrackUrl('qq', 'track', 'higher', [], options)).resolves.toBeUndefined()
  await expect(manager.resolveTrackUrl('qq', 'track', 'exhigh', [], options)).resolves.toMatchObject({ quality: 'exhigh' })
})

test.each(['kg', 'kugou'])('云端洛雪支持 %s 标识、歌曲 hash 和 24bit Hi-Res', async alias => {
  mockKugouAlias = alias
  const manager = new CloudflareLxSourceManager()
  const hash = 'a'.repeat(32)
  for (const [quality, type] of [['standard', '128k'], ['exhigh', '320k'], ['lossless', 'flac'], ['hires', 'flac24bit']]) {
    await expect(manager.resolveTrackUrl('kugou', hash, quality, [], { allowFallback: false })).resolves.toMatchObject({
      url: `https://audio.test/${alias}/${hash}/${type}`, quality
    })
  }
  expect(manager.getQualityOptions('kugou')).toEqual([
    { key: 'hires', label: 'Hi-Res 高解析' },
    { key: 'max', label: '自动最高音质（失败逐级降级）' }
  ])
  expect(await manager.getTrackQualities('kugou', hash)).toEqual([
    { key: 'hires', label: 'Hi-Res 高解析', size: 0, format: '', bitrate: null }
  ])
  expect(manager.getQualityOptions('ytmusic')).toEqual([])
})
