// 电影资料查询：片名 → IMDb 编号；IMDb 编号 → 详情 + 剧照 + 海报；中文片名 / 导演 / 简介。
// 全部是免密钥的公开接口：IMDb（suggestion + GraphQL）、Wikidata、中文维基百科。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const WIKI_UA = 'FangyingshiSync/2.0 (https://github.com/HUGEyihutian/Screening-room; personal film list)';

async function get(url, opt = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) { last = new Error('HTTP ' + r.status); await new Promise(s => setTimeout(s, 1200 * (i + 1))); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) { last = e; await new Promise(s => setTimeout(s, 800 * (i + 1))); }
  }
  throw last;
}
const json = async (url, opt) => (await get(url, opt)).json();

export const GENRE = { Drama: '剧情', Crime: '犯罪', Mystery: '悬疑', Thriller: '惊悚', Romance: '爱情', Comedy: '喜剧', Fantasy: '奇幻',
  Action: '动作', Adventure: '冒险', History: '历史', War: '战争', Biography: '传记', Documentary: '纪录', Horror: '恐怖',
  Family: '家庭', Animation: '动画', Music: '音乐', Musical: '歌舞', 'Sci-Fi': '科幻', 'Film-Noir': '黑色电影', Western: '西部', Sport: '运动', Short: '短片' };
const COUNTRY = { TW: '中国台湾', CN: '中国大陆', HK: '中国香港', MO: '中国澳门', SUHH: '苏联', XWG: '西德', DDDE: '东德', CSHH: '捷克斯洛伐克', YUCS: '南斯拉夫', XYU: '南斯拉夫' };
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
export function countryZh(code) {
  if (!code) return '';
  if (COUNTRY[code]) return COUNTRY[code];
  try { const n = regionNames.of(code); return n && n !== code ? n : code; } catch { return code; }
}
export const genresZh = list => (list || []).map(g => GENRE[g] || g).join(' / ');

/* ---------- 片名 → IMDb 编号 ---------- */
const FILM_KINDS = new Set(['movie', 'tvMovie', 'tvSeries', 'tvMiniSeries', 'short', 'video', 'tvSpecial', 'tvShort']);
export async function resolveImdb(title, year) {
  const q = String(title || '').trim();
  if (!q) return '';
  // 1. Wikidata：中文名（或别名）一字不差的电影条目最可信
  let loose = '';
  try {
    const s = await json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=zh&uselang=zh&type=item&limit=8&format=json`, { headers: { 'User-Agent': WIKI_UA } });
    const hits = s.search || [];
    if (hits.length) {
      const e = (await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hits.map(x => x.id).join('|')}&props=claims&format=json`, { headers: { 'User-Agent': WIKI_UA } })).entities || {};
      for (const h of hits) {
        const tt = e[h.id]?.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
        if (!/^tt\d+$/.test(tt || '')) continue;
        const y = +(e[h.id].claims.P577?.[0]?.mainsnak?.datavalue?.value?.time || '').slice(1, 5);
        if (year && y && Math.abs(y - year) > 1) continue;
        if (norm(h.match?.text) === norm(q)) return tt;
        loose = loose || tt;
      }
    }
  } catch (e) { console.warn('Wikidata 搜索失败', q, e.message); }
  // 2. IMDb 的搜索建议（也认中文译名）；没给年份时取最热门的一部
  try {
    const d = (await json(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q)}.json`, { headers: { 'User-Agent': UA } })).d || [];
    const c = d.filter(x => /^tt\d+$/.test(x.id) && FILM_KINDS.has(x.qid));
    const hit = year ? c.find(x => Math.abs((x.y || 0) - year) <= 1) : c.slice().sort((x, y) => (x.rank || 1e9) - (y.rank || 1e9))[0];
    if (hit) return hit.id;
  } catch (e) { console.warn('IMDb 搜索失败', q, e.message); }
  return loose;
}
const norm = s => String(s || '').replace(/[\s·・,，:：!！?？.。'’"“”—-]/g, '').toLowerCase();

/* ---------- IMDb：详情 + 图片 ---------- */
const IMG = 'edges{node{url width height type}}';
const QUERY = `query($id:ID!){ title(id:$id){
  titleText{text} originalTitleText{text} titleType{id} releaseYear{year} runtime{seconds}
  genres{genres{text}} countriesOfOrigin{countries{id}} ratingsSummary{aggregateRating}
  plot{plotText{plainText}} primaryImage{url width height}
  principalCredits{category{id} credits{name{nameText{text}}}}
  stills: images(first:40, filter:{types:["still_frame"]}){${IMG}}
  posters: images(first:12, filter:{types:["poster"]}){${IMG}}
  other: images(first:40){${IMG}}
} }`;
const imgId = u => (String(u).match(/\/images\/M\/([^.]+)\./) || [])[1] || '';
const pack = n => [imgId(n.url), n.width, n.height];
export const imgUrl = (id, w, q = 78) => `https://m.media-amazon.com/images/M/${id}._V1_QL${q}_UX${w}_.jpg`;

export async function imdbTitle(tt) {
  const r = await json('https://api.graphql.imdb.com/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'User-Agent': UA, origin: 'https://www.imdb.com', referer: 'https://www.imdb.com/' },
    body: JSON.stringify({ query: QUERY, variables: { id: tt } }),
  });
  const t = r.data?.title;
  if (!t) throw new Error('IMDb 没有这个编号');
  const credits = cat => (t.principalCredits || []).filter(c => c.category?.id === cat).flatMap(c => c.credits.map(x => x.name?.nameText?.text)).filter(Boolean);
  const nodes = k => (t[k]?.edges || []).map(e => e.node).filter(n => imgId(n.url) && n.width && n.height);
  const seen = new Set();
  const uniq = list => list.filter(n => { const id = imgId(n.url); if (seen.has(id)) return false; seen.add(id); return true; });
  const posters = uniq([...(t.primaryImage?.url ? [t.primaryImage] : []), ...nodes('posters')].filter(n => n.width >= 600 && n.height > n.width));
  // 剧照：先要横幅、够大的 still；不够 6 张就拿其它横幅图（工作照、宣传照）补
  let stills = uniq(nodes('stills').filter(n => n.width >= 900 && n.width >= n.height));
  if (stills.length < 6) stills = stills.concat(uniq(nodes('other').filter(n => n.type !== 'poster' && n.type !== 'product' && n.width >= 900 && n.width >= n.height * 1.2)));
  if (stills.length < 4) stills = stills.concat(uniq(nodes('stills').concat(nodes('other')).filter(n => n.type !== 'poster' && n.width >= 600)));
  return {
    en: t.titleText?.text || '', origRoman: t.originalTitleText?.text || '', year: t.releaseYear?.year || null,
    min: Math.round((t.runtime?.seconds || 0) / 60), genres: (t.genres?.genres || []).map(g => g.text),
    countries: (t.countriesOfOrigin?.countries || []).map(c => c.id), imdbRating: t.ratingsSummary?.aggregateRating || null,
    plot: t.plot?.plotText?.plainText || '', dir: credits('director'), cast: credits('cast'),
    kind: /series/i.test(t.titleType?.id || '') ? 'TVSeries' : 'Movie',
    stills: stills.slice(0, 24).map(pack), posters: posters.slice(0, 8).map(pack),
  };
}

/* ---------- 中文：片名 / 原名 / 导演 / 简介 ---------- */
const ZH = ['zh-cn', 'zh-hans', 'zh-sg', 'zh-my', 'zh', 'zh-hk', 'zh-tw', 'zh-hant'];
const zhLabel = e => { for (const l of ZH) if (e?.labels?.[l]?.value) return e.labels[l].value; return ''; };
const hasHan = s => /[一-鿿]/.test(s || '');

function synopsisFrom(text) {
  const clean = s => s.replace(/\[[^\]]{0,12}\]/g, '').replace(/\s+/g, ' ').trim();
  const secs = text.split(/\n(?===+[^=\n]+=+\n?)/);
  let body = '';
  for (const s of secs) {
    const m = s.match(/^=+\s*([^=\n]+?)\s*=+\n?([\s\S]*)/);
    if (m && /剧情|劇情|情节|情節|故事|内容|內容|概要|梗概/.test(m[1])) { body = m[2].replace(/\n=+[^=\n]+=+/g, '\n'); break; }
  }
  if (clean(body).length < 30) body = secs[0] || '';
  const para = clean(body.split(/\n+/).filter(p => clean(p).length > 20).slice(0, 2).join(''));
  if (para.length <= 150) return para;
  const cut = para.slice(0, 150), k = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'));
  return k > 50 ? cut.slice(0, k + 1) : cut.slice(0, 148) + '……';
}

export async function zhInfo(tt) {
  const out = { title: '', orig: '', dir: '', synopsis: '' };
  const H = { headers: { 'User-Agent': WIKI_UA } };
  const s = await json(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P345=${tt}&srlimit=1&format=json`, H);
  const qid = s.query?.search?.[0]?.title;
  if (!qid) return out;
  const langs = ZH.concat('en').join('|');
  const e = (await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|claims|sitelinks&languages=${langs}&sitefilter=zhwiki&format=json`, H)).entities[qid];
  const t = zhLabel(e); if (hasHan(t)) out.title = t;
  const native = e.claims?.P1476?.[0]?.mainsnak?.datavalue?.value?.text; if (native) out.orig = native;
  const dirIds = (e.claims?.P57 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, 3);
  if (dirIds.length) {
    const d = (await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${dirIds.join('|')}&props=labels&languages=${langs}&format=json`, H)).entities;
    const names = dirIds.map(id => zhLabel(d[id])).filter(hasHan);
    if (names.length === dirIds.length) out.dir = names.join(' / ');
  }
  const page = e.sitelinks?.zhwiki?.title;
  if (page) {
    try {
      const w = await json(`https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&converttitles=1&variant=zh-cn&format=json&titles=${encodeURIComponent(page)}`, { headers: { 'User-Agent': WIKI_UA, 'Accept-Language': 'zh-CN' } });
      const ex = Object.values(w.query?.pages || {})[0]?.extract || '';
      if (ex) out.synopsis = synopsisFrom(ex);
      const wt = Object.values(w.query?.pages || {})[0]?.title;
      if (!out.title && hasHan(wt)) out.title = wt.replace(/\s*[（(].*?[）)]$/, '');
    } catch (err) { console.warn('中文维基失败', tt, err.message); }
  }
  return out;
}

/** 一次查全：返回可直接并进 info.json 的一条。失败的部分留空，不抛错。 */
export async function lookup(tt) {
  const [a, z] = await Promise.all([
    imdbTitle(tt).catch(e => { console.warn('IMDb 详情失败', tt, e.message); return null; }),
    zhInfo(tt).catch(e => { console.warn('中文资料失败', tt, e.message); return null; }),
  ]);
  if (!a && !z) return null;
  const x = { v: 2 };
  if (a) Object.assign(x, { en: a.en, year: a.year, min: a.min, genres: a.genres.join(','), country: a.countries[0] || '', imdbRating: a.imdbRating,
    kind: a.kind, cast: a.cast.slice(0, 3).join(', '), dirEn: a.dir.join(' / '), plot: a.plot, stills: a.stills, posters: a.posters, origRoman: a.origRoman });
  if (z) Object.assign(x, { zhTitle: z.title, orig: z.orig, dirZh: z.dir, zhSynopsis: z.synopsis });
  if (!a) x.v = 1;   // IMDb 没查到，下次再试
  return x;
}
