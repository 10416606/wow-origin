const qqMappers = require('../../../dist/mappers/qq')
const neteaseMappers = require('../../../dist/mappers/netease')

describe('v1 mappers', () => {
  test('网易专辑保留碟号和不连续曲号', () => {
    const detail = neteaseMappers.mapAlbumDetail({ album: { id: 1 }, songs: [
      { id: 1, no: 8, cd: '1' },
      { id: 2, no: '12', disc: 2, cd: '1' },
      { id: 3 }
    ] })
    expect(detail.tracks.map(({ discNumber, trackNumber }) => [discNumber, trackNumber]))
      .toEqual([[1, 8], [2, 12], [undefined, undefined]])
  })

  test.each([null, 0, -1, 1.5, '', 'CD1', true, {}, Number.MAX_SAFE_INTEGER + 1])('无效位置 %p 不对外返回', (value) => {
    for (const mapped of [
      neteaseMappers.mapTrack({ no: value, disc: value }),
      qqMappers.mapTrack({ trackNumber: value, discNumber: value })
    ]) {
      const json = JSON.parse(JSON.stringify(mapped))
      expect(json).not.toHaveProperty('trackNumber')
      expect(json).not.toHaveProperty('discNumber')
    }
  })

  test('QQ 专辑累计曲序转换为碟内曲号，保持原有顺序和缺曲空位', () => {
    const detail = qqMappers.mapAlbumDetail({ id: 1, list: [
      { songmid: 'second-disc-fourth', belongCD: 16, cdIdx: 1 },
      { songmid: 'first-disc-last', belongCD: 12, cdIdx: 0 },
      { songmid: 'second-disc-first', belongCD: 13, cdIdx: 1 },
      { songmid: 'second-disc-last', belongCD: 23, cdIdx: 1 },
      { songmid: 'third-disc-first', belongCD: 24, cdIdx: 2 },
      { songmid: 'missing-track-number', cdIdx: 2 }
    ] })
    expect(detail.tracks.map(({ id, discNumber, trackNumber }) => [id, discNumber, trackNumber]))
      .toEqual([
        ['second-disc-fourth', 2, 4], ['first-disc-last', 1, 12],
        ['second-disc-first', 2, 1], ['second-disc-last', 2, 11],
        ['third-disc-first', 3, 1], ['missing-track-number', 3, undefined]
      ])
  })

  test('QQ 缺失换碟边界时不把累计曲序或列表位置作为曲号', () => {
    const detail = qqMappers.mapAlbumDetail({ id: 1, list: [
      { songmid: 'eighth', belongCD: 8, cdIdx: 0 },
      { songmid: 'second-disc', belongCD: 15, cdIdx: 1 },
      { songmid: 'unknown' }
    ] })
    expect(detail.tracks.map(({ discNumber, trackNumber }) => [discNumber, trackNumber]))
      .toEqual([[1, 8], [2, undefined], [undefined, undefined]])
    expect(qqMappers.mapTrack({ belongCD: 3 }).trackNumber).toBeUndefined()
  })

  test('QQ 歌曲详情只在第一碟直接采用累计曲序', () => {
    expect(qqMappers.mapTrack({ index_album: 8, index_cd: 0 }))
      .toMatchObject({ discNumber: 1, trackNumber: 8 })
    const secondDisc = qqMappers.mapTrack({ index_album: 13, index_cd: 1 })
    expect(secondDisc.discNumber).toBe(2)
    expect(secondDisc.trackNumber).toBeUndefined()
    expect(qqMappers.mapTrack({ index_album: 8 }).trackNumber).toBeUndefined()
  })

  test('QQ 碟号往返冲突时不覆盖换碟边界并生成错误曲号', () => {
    const detail = qqMappers.mapAlbumDetail({ id: 1, list: [
      { songmid: 'first-disc', belongCD: 13, cdIdx: 0 },
      { songmid: 'second-disc-first', belongCD: 14, cdIdx: 1 },
      { songmid: 'conflicting-disc', belongCD: 15, cdIdx: 0 },
      { songmid: 'second-disc-third', belongCD: 16, cdIdx: 1 }
    ] })
    expect(detail.tracks.map(({ discNumber }) => discNumber)).toEqual([1, 2, 1, 2])
    expect(detail.tracks.every(({ trackNumber }) => trackNumber === undefined)).toBe(true)
  })

  test('统一歌单字段和秒级时间戳', () => {
    expect(qqMappers.mapPlaylist({
      id: 123,
      name: '推荐歌单',
      createTime: 100,
      creator: { userId: 456, nickname: '创建者' }
    })).toMatchObject({
      id: '123',
      name: '推荐歌单',
      createdAt: 100000,
      creator: { id: '456', name: '创建者' }
    })
  })

  test('歌曲优先使用 mid 作为原始 ID', () => {
    expect(qqMappers.mapTrack({
      id: 1,
      mid: 'songMid',
      name: '歌曲',
      ar: [{ id: 'artistMid', name: '歌手' }],
      al: { id: 2, mid: 'albumMid', name: '专辑' },
      dt: 3000
    })).toMatchObject({
      id: 'songMid',
      artists: [{ id: 'artistMid', name: '歌手' }],
      album: { id: '2', name: '专辑' },
      durationMs: 3000,
      favorite: false
    })
  })

  test('统一歌词和音频字段', () => {
    expect(qqMappers.mapLyrics({ lrc: { lyric: '原文' }, tlyric: { lyric: '翻译' } })).toEqual({
      original: '原文', translation: '翻译', romanized: ''
    })
    expect(qqMappers.mapTrackUrl({ url: 'https://audio', level: 'higher', type: 'm4a', br: 192000 })).toMatchObject({
      url: 'https://audio', quality: 'higher', format: 'm4a', bitrate: 192000
    })
  })

  test('播放歌词使用三字段结构并清理网易 JSON 元数据', () => {
    expect(qqMappers.mapTrackLyrics(
      { lrc: { lyric: 'QQ 逐行' }, tlyric: { lyric: 'QQ 翻译' } },
      { yrc: { lyric: '[0,1000]Q(0,500)Q(500,500)' } }
    )).toEqual({
      lyrics: 'QQ 逐行',
      wordLyrics: '[0,1000]Q(0,500)Q(500,500)',
      translatedLyrics: 'QQ 翻译'
    })

    expect(neteaseMappers.mapTrackLyrics(
      { lrc: { lyric: '网易逐行' }, tlyric: { lyric: '网易翻译' } },
      {
        yrc: { lyric: '{"t":0,"c":[{"tx":"作词"}]}\n[0,1000](0,1000,0)歌' },
        ytlrc: { lyric: '[0,1000](0,1000,0)译' }
      }
    )).toEqual({
      lyrics: '网易逐行',
      wordLyrics: '[0,1000](0,1000,0)歌',
      translatedLyrics: '网易翻译'
    })
  })

  test('网易映射返回原始 ID', () => {
    expect(neteaseMappers.mapTrack({
      id: 1,
      name: '歌曲',
      ar: [{ id: 2, name: '歌手' }],
      al: { id: 3, name: '专辑' },
      dt: 3000
    })).toMatchObject({
      id: '1',
      artists: [{ id: '2', name: '歌手' }],
      album: { id: '3', name: '专辑' },
      durationMs: 3000,
      favorite: false
    })
  })

  test('网易音质码率以 bps 返回', () => {
    expect(neteaseMappers.mapTrack({
      id: 1,
      name: '歌曲',
      ar: [],
      al: {},
      l: { br: 128000, size: 100 },
      h: { br: 320000, size: 200 }
    }).qualities).toEqual([
      expect.objectContaining({ key: 'standard', bitrate: 128000 }),
      expect.objectContaining({ key: 'exhigh', bitrate: 320000 })
    ])
  })

  test('网易歌曲音质详情映射增强音质，并为 sky 采用默认 c51 变体', () => {
    const qualities = neteaseMappers.mapTrack({
      id: 123,
      name: '歌曲',
      sq: { br: 931239, size: 100 },
      hr: null,
      jm: { br: 5383538, size: 200 },
      je: { br: 3051702, size: 300 },
      sk: { br: 941890, size: 400, it: 'ste' },
      sks: [{ br: 2286826, size: 500, it: 'c51' }],
      vi: { br: 832042, size: 600 }
    }).qualities

    expect(qualities.map(({ key }) => key)).toEqual(['lossless', 'jyeffect', 'sky', 'master'])
    expect(qualities.find(({ key }) => key === 'sky')).toMatchObject({ bitrate: 2286826, size: 500 })
  })

  test('没有 c51 变体时不宣称支持默认 sky', () => {
    const qualities = neteaseMappers.mapTrack({ sk: { size: 100, it: 'ste' }, sks: [{ size: 100, it: 'ste' }] }).qualities
    expect(qualities).toEqual([])
    expect(neteaseMappers.mapTrack({ sk: { size: 100 } }).qualities.map(({ key }) => key)).toEqual(['sky'])
  })
})
