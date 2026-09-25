// 每日同步：Notion「电影档案」→ site/data.js（片单 + 影评），新片自动补 IMDb 详情和海报。
// 运行：NOTION_TOKEN=secret_xxx node scripts/sync.mjs   （GitHub Actions 里每天跑一次）
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DB = 'e0d9bc22298c4a67b747bb98c4901077';
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('缺少 NOTION_TOKEN'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

async function notion(method, url, body) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch('https://api.notion.com/v1' + url, { method, headers: H, body: body && JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    if (!r.ok) {
      const body = await r.text();
      const hint = r.status === 401 ? 'NOTION_TOKEN 不对：请重新复制集成的 Internal Integration Secret 填进 GitHub Secret。'
        : r.status === 404 ? 'Notion 找不到「电影档案」数据库：请在 Notion 打开该数据库 → 右上角 ··· → 连接 → 添加你的集成。'
        : '';
      if (hint && process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `❌ ${hint}\n`);
      throw new Error(`Notion ${r.status}${hint ? '：' + hint : ''}\n${body}`);
    }
    return r.json();
  }
  throw new Error('Notion 多次重试失败');
}

const text = p => (p?.rich_text || p?.title || []).map(t => t.plain_text).join('').trim();
function prop(pg, name) {
  const p = pg.properties[name]; if (!p) return null;
  switch (p.type) {
    case 'title': case 'rich_text': return text(p);
    case 'number': return p.number;
    case 'url': return p.url || '';
    case 'select': return p.select?.name || '';
    case 'date': return p.date?.start || '';
    default: return null;
  }
}

// 影评 = 页面正文里 "影评" 标题之后的文字（没有标题就取全文）
async function review(id) {
  let blocks = [], cursor;
  do {
    const r = await notion('GET', `/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`);
    blocks = blocks.concat(r.results); cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  const out = []; let seen = false, hasHead = blocks.some(b => /heading/.test(b.type) && text(b[b.type]).includes('影评'));
  for (const b of blocks) {
    const t = text(b[b.type] || {});
    if (/heading/.test(b.type) && t.includes('影评')) { seen = true; continue; }
    if (hasHead && !seen) continue;
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') out.push('· ' + t);
    else if (b.type === 'quote') out.push('「' + t + '」');
    else if (t) out.push(t);
    else if (b.type === 'paragraph') out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// IMDb：新片补详情（导演/片长/类型/评分/地区）和海报
async function imdbInfo(tt) {
  try {
    const h = await (await fetch(`https://www.imdb.com/title/${tt}/`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US' } })).text();
    const j = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    const c = h.match(/"countriesOfOrigin":\{"countries":\[(.*?)\]/);
    const d = (j.duration || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/) || [];
    return { dir: (j.director || []).map(x => x.name).join(' / '), min: (+d[1] || 0) * 60 + (+d[2] || 0), genres: (j.genre || []).join(','),
      imdbRating: j.aggregateRating?.ratingValue || null, country: c ? ([...c[1].matchAll(/"id":"(\w+)"/g)][0] || [])[1] || '' : '',
      kind: j['@type'] || 'Movie', synopsis: '' };
  } catch (e) { console.warn('IMDb 详情失败', tt, e.message); return null; }
}
async function poster(tt, file) {
  try {
    const d = (await (await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${tt}.json`)).json()).d?.find(x => x.id === tt);
    if (!d?.i?.imageUrl) return false;
    const r = await fetch(d.i.imageUrl.replace(/\._V1_.*\.jpg$/, '._V1_QL82_UX500_.jpg'));
    if (!r.ok) return false;
    await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
    const hd = await fetch(d.i.imageUrl.replace(/\._V1_.*\.jpg$/, '._V1_QL80_UX1100_.jpg'));   // 片头推镜头用
    if (hd.ok) await fs.writeFile(file.replace(/posters([\\/])/, 'posters-hd$1'), Buffer.from(await hd.arrayBuffer()));
    return true;
  } catch (e) { console.warn('海报失败', tt, e.message); return false; }
}

const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const info = await readJSON(path.join(ROOT, 'data/info.json'), {});
const order = await readJSON(path.join(ROOT, 'data/order.json'), []);

// 1. 拉全部行
let pages = [], cursor;
do {
  const r = await notion('POST', `/databases/${DB}/query`, { page_size: 100, start_cursor: cursor });
  pages = pages.concat(r.results); cursor = r.has_more ? r.next_cursor : null;
} while (cursor);
pages = pages.filter(p => !p.archived && !p.in_trash);
console.log('Notion 行数', pages.length);

// 2. 顺序：已知的按 order.json，新的按 序号/创建时间 追加
const idOf = p => p.id.replace(/-/g, '');
const known = new Map(order.map((id, i) => [id, i]));
pages.sort((a, b) => {
  const ka = known.has(idOf(a)) ? known.get(idOf(a)) : 1e9, kb = known.has(idOf(b)) ? known.get(idOf(b)) : 1e9;
  if (ka !== kb) return ka - kb;
  return (prop(a, '序号') || Date.parse(a.created_time)) - (prop(b, '序号') || Date.parse(b.created_time));
});
const newOrder = pages.map(idOf);

// 3. 逐条整理（影评并发 4 条）
const films = [];
const posterDir = path.join(ROOT, 'site/posters');
const have = new Set((await fs.readdir(posterDir)).map(f => f.replace(/\.jpg$/, '')));
for (let i = 0; i < pages.length; i += 4) {
  const chunk = pages.slice(i, i + 4);
  const reviews = await Promise.all(chunk.map(p => review(p.id).catch(e => { console.warn('影评失败', p.id, e.message); return ''; })));
  for (const [k, p] of chunk.entries()) {
    const tt = ((prop(p, 'IMDb') || '').match(/tt\d{6,9}/) || [])[0] || '';
    if (tt && !info[tt]) { const x = await imdbInfo(tt); if (x) info[tt] = x; }
    if (tt && !have.has(tt) && await poster(tt, path.join(posterDir, tt + '.jpg'))) have.add(tt);
    films.push({
      id: idOf(p), imdb: tt, title: (prop(p, '片名') || '（无名）').replace(/\*\*/g, ''), orig: prop(p, '原名') || '', en: prop(p, '英文名') || '',
      year: prop(p, '年份') || null, group: prop(p, '分组') || '我自己看的', cast: prop(p, '主演') || '', douban: prop(p, '豆瓣') || '',
      line: prop(p, '一句话') || '', stars: (prop(p, '我的评分') || '').length, watched: prop(p, '观看日期') || '',
      dir: prop(p, '导演') || '', country: prop(p, '地区') || '', min: prop(p, '片长') || 0, genres: prop(p, '类型') || '',
      synopsis: prop(p, '简介') || '', review: reviews[k],
    });
  }
}

// 4. 写出
const js = '// 由 scripts/sync.mjs 生成，勿手改\n' +
  `window.FILM_SYNCED_AT = ${JSON.stringify(new Date().toISOString())};\n` +
  `window.FILM_SNAPSHOT = ${JSON.stringify(films)};\n` +
  `window.FILM_INFO = ${JSON.stringify(info)};\n` +
  `window.FILM_POSTERS = ${JSON.stringify([...have].sort())};\n`;
await fs.writeFile(path.join(ROOT, 'site/data.js'), js);
await fs.writeFile(path.join(ROOT, 'data/info.json'), JSON.stringify(info, null, 2));
await fs.writeFile(path.join(ROOT, 'data/order.json'), JSON.stringify(newOrder, null, 2));
const done = `✅ 已从 Notion 同步：${films.length} 部，影评 ${films.filter(f => f.review).length} 篇，海报 ${have.size} 张`;
console.log(done);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, done + '\n');
