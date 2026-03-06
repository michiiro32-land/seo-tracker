import { createClient } from '@supabase/supabase-js'
import { checkRank } from './check-rank.js'

const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const supabase = createClient(SUPA_URL, SUPA_KEY)

    // アクティブなキーワードを全件取得
    const { data: keywords, error } = await supabase
      .from('seo_keywords')
      .select('*')
      .eq('active', true)

    if (error) throw new Error(error.message)
    if (!keywords || keywords.length === 0) {
      return res.json({ checked: 0, results: [] })
    }

    const results = []

    for (const kw of keywords) {
      try {
        const result = await checkRank(kw.keyword, kw.target_domain)
        await supabase.from('seo_rankings').insert({
          keyword_id: kw.id,
          rank: result.rank,
          found_url: result.foundUrl,
        })
        results.push({ keyword: kw.keyword, ...result })

        // Brave APIレート制限対策 (少し待機)
        await new Promise(r => setTimeout(r, 300))
      } catch (e) {
        results.push({ keyword: kw.keyword, error: e.message })
      }
    }

    return res.json({ checked: keywords.length, results })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
