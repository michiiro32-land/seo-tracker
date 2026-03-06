import { createClient } from '@supabase/supabase-js'

const BRAVE_KEY   = process.env.BRAVE_API_KEY
const SUPA_URL    = process.env.SUPABASE_URL
const SUPA_KEY    = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { keyword, domain, kwId } = req.method === 'POST'
    ? req.body
    : req.query

  if (!keyword || !domain) {
    return res.status(400).json({ error: 'keyword and domain are required' })
  }

  try {
    const result = await checkRank(keyword, domain)

    // Supabaseに記録
    if (kwId) {
      const supabase = createClient(SUPA_URL, SUPA_KEY)
      await supabase.from('seo_rankings').insert({
        keyword_id: kwId,
        rank: result.rank,
        found_url: result.foundUrl,
      })
    }

    return res.json(result)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// ── 順位チェック（最大30位まで調べる）─────────────────
export async function checkRank(keyword, domain) {
  // 正規化: https://を取り除いてドメインだけにする
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()

  let rank = null
  let foundUrl = null

  for (let offset = 0; offset < 30; offset += 10) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(keyword)}&count=10&offset=${offset}`
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY }
    })
    if (!r.ok) throw new Error(`Brave API error: ${r.status}`)
    const data = await r.json()
    const results = data.web?.results || []

    for (let i = 0; i < results.length; i++) {
      const resultDomain = new URL(results[i].url).hostname.toLowerCase().replace(/^www\./, '')
      const targetDomain = cleanDomain.replace(/^www\./, '')
      if (resultDomain.includes(targetDomain) || targetDomain.includes(resultDomain)) {
        rank = offset + i + 1
        foundUrl = results[i].url
        break
      }
    }
    if (rank !== null) break
    if (results.length < 10) break // これ以上結果がない
  }

  return { rank, foundUrl }
}
