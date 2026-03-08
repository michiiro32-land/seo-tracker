import { createClient } from '@supabase/supabase-js'
import { checkRank } from './check-rank.js'

const SUPA_URL     = process.env.SUPABASE_URL
const SUPA_KEY     = process.env.SUPABASE_SERVICE_KEY
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_CHANNEL = process.env.DISCORD_NOTIFY_CHANNEL || '1475323304834240605'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  // Vercel Cronからの呼び出しかどうか確認（セキュリティ）
  const isCron = req.headers['x-vercel-cron'] === '1'

  try {
    const supabase = createClient(SUPA_URL, SUPA_KEY)

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

        // 前回の順位を取得（変動計算用）
        const { data: prevData } = await supabase
          .from('seo_rankings')
          .select('rank')
          .eq('keyword_id', kw.id)
          .order('checked_at', { ascending: false })
          .limit(2)

        const prevRank = prevData?.[1]?.rank ?? null
        results.push({ keyword: kw.keyword, domain: kw.target_domain, rank: result.rank, prevRank })

        await new Promise(r => setTimeout(r, 300))
      } catch (e) {
        results.push({ keyword: kw.keyword, domain: kw.target_domain, error: e.message })
      }
    }

    // Discord通知
    if (DISCORD_TOKEN && (isCron || req.query.notify === '1')) {
      await notifyDiscord(results)
    }

    return res.json({ checked: keywords.length, results })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}

// ── Discord通知 ────────────────────────────────────
async function notifyDiscord(results) {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const dateStr = `${jst.getFullYear()}-${String(jst.getMonth()+1).padStart(2,'0')}-${String(jst.getDate()).padStart(2,'0')}`

  const lines = results.map(r => {
    if (r.error) return `❓ **${r.keyword}** → エラー`
    const rankStr = r.rank ? `**${r.rank}位**` : '**圏外**'
    let diffStr = ''
    if (r.prevRank && r.rank) {
      const diff = r.prevRank - r.rank
      if (diff > 0) diffStr = ` 🟢 ↑${diff}`
      else if (diff < 0) diffStr = ` 🔴 ↓${Math.abs(diff)}`
      else diffStr = ` ⚪ 変動なし`
    } else if (!r.rank && r.prevRank) {
      diffStr = ` 🔴 圏外へ`
    }
    return `・${r.keyword}（${r.domain}）→ ${rankStr}${diffStr}`
  })

  const content = [
    `📊 **SEOランク定点調査** ${dateStr}`,
    ``,
    ...lines,
    ``,
    `🔗 詳細: https://seo-tracker-eight.vercel.app`
  ].join('\n')

  await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content })
  })
}
