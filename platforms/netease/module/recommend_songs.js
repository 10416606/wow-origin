//每日推荐单曲

function songs(body) {
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.data?.dailySongs)) return body.data.dailySongs
  if (Array.isArray(body?.dailySongs)) return body.dailySongs
  if (Array.isArray(body?.recommend)) return body.recommend
  return []
}

module.exports = async (query, request) => {
  const options = { useCheckToken: false, MUSIC_U: query.MUSIC_U || '' }
  const legacy = await request('/api/v1/discovery/recommend/songs', {
    limit: query.limit || 100
  }, { ...options, crypto: 'eapi' })
  const legacyBody = legacy.body

  // The old EAPI route can return only a few songs even when the account has a
  // full daily list. Ask the Web route used by current clients before accepting
  // an unexpectedly short result, and retain the old response if it fails.
  if (songs(legacyBody).length >= 10) return legacyBody

  let best = legacyBody
  const attempts = [{ transport: 'eapi', count: songs(best).length }]
  for (const [crypto, data] of [['weapi', { afresh: false }], ['xeapi', { ispush: false }]]) {
    try {
      const current = await request('/api/v3/discovery/recommend/songs', data, { ...options, crypto })
      const count = songs(current.body).length
      attempts.push({ transport: crypto, count })
      if (count > songs(best).length) best = current.body
      if (songs(best).length >= 10) return best
    } catch (error) {
      // Log only numeric status, never cookies, URLs, upstream messages or bodies.
      const status = error?.status ?? error?.body?.code ?? error?.response?.status
      attempts.push({ transport: crypto, failed: true, status: typeof status === 'number' ? status : null })
    }
  }
  console.warn('[netease-daily] incomplete recommendations', JSON.stringify(attempts))
  return best
}
