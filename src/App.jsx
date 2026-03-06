import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'

// ── 定数 ──────────────────────────────────────────
const RANK_LIMIT = 30

// ── ユーティリティ ────────────────────────────────
function rankBadge(rank) {
  if (!rank) return { label: '圏外', color: '#94a3b8', bg: '#f1f5f9' }
  if (rank <= 3)  return { label: `${rank}位`, color: '#fff', bg: '#f59e0b' }
  if (rank <= 10) return { label: `${rank}位`, color: '#fff', bg: '#3b82f6' }
  return { label: `${rank}位`, color: '#fff', bg: '#64748b' }
}

function diffBadge(curr, prev) {
  if (!prev) return null
  const diff = prev - curr // 上がれば正
  if (diff === 0) return { label: '±0', color: '#94a3b8' }
  if (!curr) return { label: `↓圏外`, color: '#ef4444' }
  if (diff > 0) return { label: `↑${diff}`, color: '#22c55e' }
  return { label: `↓${Math.abs(diff)}`, color: '#ef4444' }
}

function formatDate(ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// ── メインアプリ ──────────────────────────────────
export default function App() {
  const [keywords, setKeywords] = useState([])
  const [rankings, setRankings] = useState({}) // keyword_id → [latest, prev]
  const [selected, setSelected] = useState(null) // 選択中のkeyword_id
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState({}) // keyword_id → bool
  const [checkingAll, setCheckingAll] = useState(false)
  const [form, setForm] = useState({ keyword: '', target_domain: '' })
  const [addError, setAddError] = useState('')
  const [msg, setMsg] = useState('')

  // ── データ取得 ────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: kws } = await supabase
      .from('seo_keywords')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })
    if (!kws) { setLoading(false); return }
    setKeywords(kws)

    // 各キーワードの最新2件の順位を取得
    const rankMap = {}
    await Promise.all(kws.map(async (kw) => {
      const { data } = await supabase
        .from('seo_rankings')
        .select('*')
        .eq('keyword_id', kw.id)
        .order('checked_at', { ascending: false })
        .limit(2)
      rankMap[kw.id] = data || []
    }))
    setRankings(rankMap)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── 履歴取得 ──────────────────────────────────────
  const fetchHistory = async (kwId) => {
    const { data } = await supabase
      .from('seo_rankings')
      .select('*')
      .eq('keyword_id', kwId)
      .order('checked_at', { ascending: false })
      .limit(30)
    setHistory(data || [])
    setSelected(kwId)
  }

  // ── キーワード追加 ────────────────────────────────
  const addKeyword = async () => {
    setAddError('')
    if (!form.keyword.trim()) return setAddError('キーワードを入力してください')
    if (!form.target_domain.trim()) return setAddError('調査ドメインを入力してください')
    // ドメイン正規化
    const domain = form.target_domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const { error } = await supabase.from('seo_keywords').insert({
      keyword: form.keyword.trim(),
      target_domain: domain,
    })
    if (error) { setAddError('追加に失敗しました'); return }
    setForm({ keyword: '', target_domain: '' })
    await fetchData()
    flash('✅ キーワードを追加しました')
  }

  // ── キーワード削除 ────────────────────────────────
  const deleteKeyword = async (id) => {
    if (!confirm('削除しますか？')) return
    await supabase.from('seo_keywords').update({ active: false }).eq('id', id)
    if (selected === id) setSelected(null)
    await fetchData()
    flash('🗑️ 削除しました')
  }

  // ── 順位チェック (1件) ────────────────────────────
  const checkOne = async (kw) => {
    setChecking(c => ({ ...c, [kw.id]: true }))
    try {
      const res = await fetch(`/api/check-rank?keyword=${encodeURIComponent(kw.keyword)}&domain=${encodeURIComponent(kw.target_domain)}&kwId=${kw.id}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      flash(`✅ "${kw.keyword}" → ${data.rank ? `${data.rank}位` : '圏外'}`)
      await fetchData()
      if (selected === kw.id) fetchHistory(kw.id)
    } catch (e) {
      flash(`❌ チェック失敗: ${e.message}`)
    }
    setChecking(c => ({ ...c, [kw.id]: false }))
  }

  // ── 全件チェック ──────────────────────────────────
  const checkAll = async () => {
    setCheckingAll(true)
    flash('🔍 全件チェック中...')
    try {
      const res = await fetch('/api/check-all')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      flash(`✅ 全件チェック完了 (${data.checked}件)`)
      await fetchData()
      if (selected) fetchHistory(selected)
    } catch (e) {
      flash(`❌ 全件チェック失敗: ${e.message}`)
    }
    setCheckingAll(false)
  }

  // ── CSV出力 ───────────────────────────────────────
  const exportCSV = () => {
    const rows = [['キーワード', 'ドメイン', '最新順位', '前回順位', '変動', '最終チェック']]
    keywords.forEach(kw => {
      const r = rankings[kw.id] || []
      const latest = r[0]?.rank
      const prev   = r[1]?.rank
      const diff   = (latest && prev) ? (prev - latest) : ''
      const date   = r[0]?.checked_at ? formatDate(r[0].checked_at) : ''
      rows.push([kw.keyword, kw.target_domain, latest || '圏外', prev || '-', diff, date])
    })
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `seo-rankings-${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  // ── フラッシュメッセージ ──────────────────────────
  const flash = (text) => {
    setMsg(text)
    setTimeout(() => setMsg(''), 4000)
  }

  // ── 選択中キーワード情報 ──────────────────────────
  const selectedKw = keywords.find(k => k.id === selected)

  // ── スタイル定義 ──────────────────────────────────
  const S = {
    body: { minHeight: '100vh', background: 'linear-gradient(135deg,#667eea 0%,#764ba2 100%)', padding: '24px 16px', fontFamily: "'Segoe UI',sans-serif" },
    wrap: { maxWidth: 960, margin: '0 auto' },
    header: { textAlign: 'center', marginBottom: 24 },
    title: { fontSize: 'clamp(1.4rem,4vw,2rem)', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: 1 },
    subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem', marginTop: 4 },
    card: { background: '#fff', borderRadius: 16, padding: '20px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.1)', marginBottom: 16 },
    label: { fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, display: 'block' },
    input: { width: '100%', padding: '10px 14px', borderRadius: 10, border: '2px solid #e2e8f0', fontSize: '0.95rem', outline: 'none', boxSizing: 'border-box', transition: 'border 0.2s' },
    btnPrimary: { padding: '10px 20px', background: 'linear-gradient(135deg,#667eea,#764ba2)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', whiteSpace: 'nowrap' },
    btnGray: { padding: '8px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' },
    btnDanger: { padding: '6px 12px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' },
    btnCheck: { padding: '6px 12px', background: '#ede9fe', color: '#7c3aed', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { textAlign: 'left', padding: '10px 12px', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', borderBottom: '2px solid #f1f5f9' },
    td: { padding: '12px 12px', borderBottom: '1px solid #f8fafc', fontSize: '0.9rem', color: '#334155' },
    flash: { position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e293b', color: '#fff', padding: '12px 24px', borderRadius: 30, fontWeight: 600, fontSize: '0.9rem', zIndex: 999, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' },
  }

  return (
    <div style={S.body}>
      <div style={S.wrap}>
        {/* ヘッダー */}
        <div style={S.header}>
          <h1 style={S.title}>📊 SEOランクトラッカー</h1>
          <p style={S.subtitle}>キーワードの検索順位を毎日自動チェック</p>
        </div>

        {/* キーワード追加フォーム */}
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={S.label}>キーワード</label>
              <input style={S.input} placeholder="例: 美容室 渋谷" value={form.keyword}
                onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addKeyword()} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={S.label}>調査ドメイン</label>
              <input style={S.input} placeholder="例: example.com" value={form.target_domain}
                onChange={e => setForm(f => ({ ...f, target_domain: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addKeyword()} />
            </div>
            <button style={S.btnPrimary} onClick={addKeyword}>＋ 追加</button>
          </div>
          {addError && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: 8 }}>{addError}</p>}
        </div>

        {/* アクションバー */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
            {loading ? '読み込み中...' : `${keywords.length}件のキーワード`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.btnGray} onClick={exportCSV} disabled={keywords.length === 0}>📥 CSV</button>
            <button style={{ ...S.btnPrimary, opacity: checkingAll ? 0.7 : 1 }}
              onClick={checkAll} disabled={checkingAll || keywords.length === 0}>
              {checkingAll ? '⏳ チェック中...' : '🔍 全件チェック'}
            </button>
          </div>
        </div>

        {/* キーワード一覧テーブル */}
        <div style={S.card}>
          {keywords.length === 0 && !loading ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>
              キーワードを追加してください
            </p>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>キーワード</th>
                  <th style={S.th}>ドメイン</th>
                  <th style={{ ...S.th, textAlign: 'center' }}>順位</th>
                  <th style={{ ...S.th, textAlign: 'center' }}>変動</th>
                  <th style={S.th}>最終チェック</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {keywords.map(kw => {
                  const r = rankings[kw.id] || []
                  const latest = r[0]
                  const prev   = r[1]
                  const badge  = rankBadge(latest?.rank)
                  const diff   = diffBadge(latest?.rank, prev?.rank)
                  return (
                    <tr key={kw.id}
                      style={{ cursor: 'pointer', background: selected === kw.id ? '#faf5ff' : 'transparent' }}
                      onClick={() => fetchHistory(kw.id)}>
                      <td style={{ ...S.td, fontWeight: 600, color: '#1e293b' }}>{kw.keyword}</td>
                      <td style={{ ...S.td, color: '#64748b', fontSize: '0.85rem' }}>{kw.target_domain}</td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: badge.bg, color: badge.color, fontWeight: 700, fontSize: '0.85rem' }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        {diff ? (
                          <span style={{ fontWeight: 700, color: diff.color }}>{diff.label}</span>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>-</span>
                        )}
                      </td>
                      <td style={{ ...S.td, color: '#94a3b8', fontSize: '0.82rem' }}>
                        {latest ? formatDate(latest.checked_at) : '未チェック'}
                      </td>
                      <td style={{ ...S.td }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ ...S.btnCheck, opacity: checking[kw.id] ? 0.6 : 1 }}
                            onClick={() => checkOne(kw)} disabled={checking[kw.id]}>
                            {checking[kw.id] ? '⏳' : '🔍'}
                          </button>
                          <button style={S.btnDanger} onClick={() => deleteKeyword(kw.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 履歴パネル */}
        {selected && selectedKw && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>📈 {selectedKw.keyword}</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>{selectedKw.target_domain}</p>
              </div>
              <button style={S.btnGray} onClick={() => setSelected(null)}>✕ 閉じる</button>
            </div>

            {/* ミニチャート */}
            {history.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <MiniChart data={history.slice().reverse()} />
              </div>
            )}

            {/* 履歴テーブル */}
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>チェック日時</th>
                  <th style={{ ...S.th, textAlign: 'center' }}>順位</th>
                  <th style={S.th}>発見URL</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => {
                  const badge = rankBadge(r.rank)
                  const prev  = history[i + 1]?.rank
                  const diff  = diffBadge(r.rank, prev)
                  return (
                    <tr key={r.id}>
                      <td style={S.td}>{formatDate(r.checked_at)}</td>
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 20, background: badge.bg, color: badge.color, fontWeight: 700, fontSize: '0.82rem' }}>
                          {badge.label}
                        </span>
                        {diff && (
                          <span style={{ marginLeft: 6, fontSize: '0.8rem', fontWeight: 700, color: diff.color }}>{diff.label}</span>
                        )}
                      </td>
                      <td style={{ ...S.td, fontSize: '0.75rem', color: '#64748b', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.found_url ? (
                          <a href={r.found_url} target="_blank" rel="noopener noreferrer" style={{ color: '#667eea' }}>{r.found_url}</a>
                        ) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* フラッシュメッセージ */}
      {msg && <div style={S.flash}>{msg}</div>}
    </div>
  )
}

// ── ミニチャート ──────────────────────────────────
function MiniChart({ data }) {
  const W = 600, H = 80, PAD = 20
  const ranks = data.map(d => d.rank || (RANK_LIMIT + 5))
  const maxR = Math.max(...ranks, 10)
  const minR = Math.max(1, Math.min(...ranks) - 2)
  const pts = ranks.map((r, i) => {
    const x = PAD + (i / (ranks.length - 1 || 1)) * (W - PAD * 2)
    const y = PAD + ((r - minR) / (maxR - minR || 1)) * (H - PAD * 2)
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80 }}>
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#667eea" />
          <stop offset="100%" stopColor="#764ba2" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {ranks.map((r, i) => {
        const x = PAD + (i / (ranks.length - 1 || 1)) * (W - PAD * 2)
        const y = PAD + ((r - minR) / (maxR - minR || 1)) * (H - PAD * 2)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="4" fill="#667eea" />
            <text x={x} y={y - 8} textAnchor="middle" fontSize="10" fill="#64748b">
              {data[i].rank ? `${data[i].rank}位` : '圏外'}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
