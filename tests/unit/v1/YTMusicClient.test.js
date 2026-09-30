const { YTMusicClient } = require('../../../dist/clients/YTMusicClient');
const { createStreamUrl, verifyStreamRequest } = require('../../../dist/ytmusic/stream');

function row(id, title, artist = 'Daft Punk') {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: id },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [
          { text: artist, navigationEndpoint: { browseEndpoint: { browseId: 'UCartist' } } },
          { text: ' • ' }, { text: '2:30' }
        ] } } }
      ],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '2:30' }] } } }]
    }
  };
}

function mockResponse(payload) {
  return { ok: true, json: async () => payload };
}

describe('YouTube Music Wow client', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  test('search paginates InnerTube results and maps playable track identifiers', async () => {
    const calls = [];
    global.fetch = jest.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const items = body.continuation ? [row('22222222222', 'Second')] : [row('11111111111', 'First')];
      return mockResponse({
        contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: {
          sectionListRenderer: { contents: [{ musicShelfRenderer: {
            contents: items,
            ...(body.continuation ? {} : { continuations: [{ nextContinuationData: { continuation: 'next' } }] })
          } }] }
        } } }] } }
      });
    });

    const result = await new YTMusicClient('').searchTracks('Daft Punk', 1, 1);
    expect(result.items).toMatchObject([{ id: '22222222222', title: 'Second', durationMs: 150000 }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ query: 'Daft Punk', params: expect.any(String) });
    expect(calls[1].continuation).toBe('next');
  });

  test('player request uses visitor context and selects AAC audio', async () => {
    let body;
    global.fetch = jest.fn(async (url, options) => {
      if (String(url).includes('/watch?')) return { ok: true, text: async () => '<script>"VISITOR_DATA":"visitor-for-test"</script>' };
      body = JSON.parse(options.body);
      return mockResponse({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [
        { mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, url: 'https://audio.example/opus' },
        { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, url: 'https://audio.example/aac', contentLength: '999' }
      ] } });
    });
    const client = new YTMusicClient('');
    client.setStreamUrl((id) => `https://wow.example/v1/ytmusic/audio/${id}`);
    const result = await client.getTrackUrl('11111111111', 'higher');
    expect(body.context.client).toMatchObject({ clientName: 'VISIONOS', visitorData: 'visitor-for-test' });
    expect(result).toEqual({
      url: 'https://wow.example/v1/ytmusic/audio/11111111111',
      quality: 'higher', format: 'm4a', bitrate: 128000, size: 999
    });
  });

  test('track detail uses square Music artwork instead of the video thumbnail', async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes('/watch?')) {
        return { ok: true, text: async () => '<script>"VISITOR_DATA":"visitor-for-test"</script>' };
      }
      if (String(url).includes('/youtubei/v1/player')) {
        return mockResponse({ videoDetails: {
          title: 'Song', author: 'Artist', lengthSeconds: '180',
          thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/video.jpg', width: 1280, height: 720 }] }
        } });
      }
      return mockResponse({ contents: { playlistPanelVideoRenderer: {
        videoId: '11111111111',
        thumbnail: { thumbnails: [
          { url: 'https://image.example/120.jpg', width: 120, height: 120 },
          { url: 'https://image.example/544.jpg', width: 544, height: 544 }
        ] }
      } } });
    });

    const detail = await new YTMusicClient('').getTrackDetail('11111111111');
    expect(detail).toMatchObject({
      id: '11111111111', durationMs: 180000,
      album: { coverUrl: 'https://image.example/544.jpg' }
    });
  });

  test('browser Cookie account request sends auth-user and Music visitor context', async () => {
    const cookie = '__Secure-3PAPISID=test-secret; SID=test-session';
    let request;
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === 'https://music.youtube.com') {
        return { ok: true, text: async () => '<script>"VISITOR_DATA":"music-visitor"</script>' };
      }
      request = options;
      return mockResponse({ actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: {
        header: { activeAccountHeaderRenderer: {
          accountName: { runs: [{ text: 'Test account' }] },
          channelHandle: { runs: [{ text: '@test' }] },
          accountPhoto: { thumbnails: [{ url: 'https://image.example/avatar' }] }
        } }
      } } } }] });
    });

    const profile = await new YTMusicClient(cookie).getUserMe();
    expect(profile).toMatchObject({ nickname: 'Test account', userId: '@test' });
    expect(request.headers).toMatchObject({
      Cookie: cookie,
      'X-Goog-AuthUser': '0',
      'X-Goog-Visitor-Id': 'music-visitor'
    });
    expect(request.headers.Authorization).toMatch(/^SAPISIDHASH \d+_[a-f0-9]{40}$/);
    expect(JSON.parse(request.body).context.client.visitorData).toBe('music-visitor');
  });

  test('anonymous account menu reports an actionable Cookie error', async () => {
    global.fetch = jest.fn(async (url) => String(url) === 'https://music.youtube.com'
      ? { ok: true, text: async () => '<script>"VISITOR_DATA":"anonymous-visitor"</script>' }
      : mockResponse({ actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: {
        sections: [{ multiPageMenuSectionRenderer: {} }]
      } } } }] }));
    await expect(new YTMusicClient('__Secure-3PAPISID=expired').getUserMe())
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('youtubei/v1/browse') });
  });

  test('signed-in home without playlists falls back to public recommendations', async () => {
    const browseTile = (id) => ({ musicTwoRowItemRenderer: {
      title: { runs: [{ text: 'Recommendation' }] },
      navigationEndpoint: { browseEndpoint: { browseId: id } },
      thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://image.example/cover' }] } } }
    } });
    global.fetch = jest.fn(async (url, options) => {
      if (String(url) === 'https://music.youtube.com') {
        return { ok: true, text: async () => '<script>"VISITOR_DATA":"home-visitor"</script>' };
      }
      return mockResponse({ contents: { sectionListRenderer: { contents: [
        options.headers.Cookie ? browseTile('MPREalbum') : browseTile('VLPLplaylist')
      ] } } });
    });
    const page = await new YTMusicClient('__Secure-3PAPISID=home-test').getRecommendedPlaylist(0, 10);
    expect(page.items).toMatchObject([{ id: 'PLplaylist', name: 'Recommendation' }]);
    expect(page.hasMore).toBe(false);
  });

  test('signed audio URL rejects tampering and expiration', () => {
    const account = { platform: 'ytmusic', apiAccessKey: 'secret-for-test' };
    const url = new URL(createStreamUrl('https://wow.example', account, '11111111111', 'higher'));
    const query = Object.fromEntries(url.searchParams);
    expect(verifyStreamRequest([account], '11111111111', query)).toEqual({ account, quality: 'higher' });
    expect(verifyStreamRequest([account], '22222222222', query)).toBeNull();
    expect(verifyStreamRequest([account], '11111111111', { ...query, quality: 'standard' })).toBeNull();
    expect(verifyStreamRequest([account], '11111111111', { ...query, expires: '1' })).toBeNull();
  });
});
