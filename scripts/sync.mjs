// 同步：Notion「电影档案」⇄ 放映室。
//   1. 读片单和影评；
//   2. 只填了片名或 IMDb 链接的行：自动查齐资料（片名/原名/英文名/年份/导演/主演/地区/片长/类型/简介/海报），
//      并把查到的写回 Notion 里空着的栏目；
//   3. 每部片下载海报和几张高清剧照，记下更多剧照/海报的地址；收下 Notion「剧照」栏里手动上传的图；
//   4. 生成 site/data.js。
// 运行：NOTION_TOKEN=secret_xxx node scripts/sync.mjs      （GitHub Actions 每 15 分钟跑一次）
//       node scripts/sync.mjs --local                      （不连 Notion，只按现有片单补资料和图片）
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lookup, resolveImdb, imgUrl, countryZh, genresZh } from './lookup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'e0d9bc22298c4a67b747bb98c4901077';
const LOCAL = process.argv.includes('--local');
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN && !LOCAL) { console.error('缺少 NOTION_TOKEN'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
const LOCAL_STILLS = 4;          // 每部片存进仓库的剧照张数（其余按地址直接从图库取）
const summary = [];
const say = s => { console.log(s); summary.push(s); };

async function notion(method, url, body) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch('https://api.notion.com/v1' + url, { method, headers: H, body: body && JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`Notion ${r.status}\n${text}`); err.status = r.status; throw err;
    }
    return r.json();
  }
  throw new Error('Notion 多次重试失败');
}
const READ_HINT = { 401: 'NOTION_TOKEN 不对：请重新复制集成的 Internal Integration Secret 填进 GitHub Secret。',
  404: 'Notion 找不到「电影档案」数据库：请在 Notion 打开该数据库 → 右上角 ··· → 连接 → 添加你的集成。' };

const text = p => (p?.rich_text || p?.title || []).map(t => t.plain_text).join('').trim();
function prop(pg, name) {
  const p = pg.properties[name]; if (!p) return null;
  switch (p.type) {
    case 'title': case 'rich_text': return text(p);
    case 'number': return p.number;
    case 'url': return p.url || '';
    case 'select': return p.select?.name || '';
    case 'date': return p.date?.start || '';
    case 'files': return p.files || [];
    default: return null;
  }
}
// 按栏目的实际类型拼出写回 Notion 的值
function propValue(pg, name, v) {
  const t = pg.properties[name]?.type;
  if (t === 'title') return { title: [{ text: { content: String(v).slice(0, 1900) } }] };
  if (t === 'rich_text') return { rich_text: [{ text: { content: String(v).slice(0, 1900) } }] };
  if (t === 'number') return Number.isFinite(+v) ? { number: +v } : null;
  if (t === 'url') return { url: String(v) };
  return null;
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

const exists = f => fs.access(f).then(() => true, () => false);
async function download(url, file, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error('文件太小');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf);
  return buf;
}
const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const sharp = await import('sharp').then(m => m.default, () => null);   // 没装也能跑，只是手动上传的图不压缩

const info = await readJSON(path.join(ROOT, 'data/info.json'), {});      // 按 IMDb 编号存的资料（含人工写的中文简介）
const order = await readJSON(path.join(ROOT, 'data/order.json'), []);
const cache = await readJSON(path.join(ROOT, 'data/pages.json'), {});    // 每页：上次编辑时间、影评、自动填过的栏目
const idOf = p => p.id.replace(/-/g, '');

/* ---------- 1. 片单 ---------- */
let pages = [];
if (LOCAL) {
  globalThis.window = {};
  (0, eval)(await fs.readFile(path.join(ROOT, 'site/data.js'), 'utf8'));
} else {
  let cursor;
  try {
    do {
      const r = await notion('POST', `/databases/${DB}/query`, { page_size: 100, start_cursor: cursor });
      pages = pages.concat(r.results); cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
  } catch (e) {
    if (READ_HINT[e.status] && process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `❌ ${READ_HINT[e.status]}\n`);
    throw e;
  }
  pages = pages.filter(p => !p.archived && !p.in_trash);
  console.log('Notion 行数', pages.length);
  const known = new Map(order.map((id, i) => [id, i]));
  pages.sort((a, b) => {
    const ka = known.has(idOf(a)) ? known.get(idOf(a)) : 1e9, kb = known.has(idOf(b)) ? known.get(idOf(b)) : 1e9;
    if (ka !== kb) return ka - kb;
    return (prop(a, '序号') || Date.parse(a.created_time)) - (prop(b, '序号') || Date.parse(b.created_time));
  });
}

/* ---------- 2. 资料：查齐并写回 ---------- */
// 每个栏目的自动值；人工写在 info.json 里的中文导演/简介优先
function autoFields(x, tt) {
  if (!x) return {};
  return {
    '片名': x.zhTitle || x.en || '', '原名': x.orig && x.orig !== x.zhTitle ? x.orig : '', '英文名': x.en || '',
    '年份': x.year || null, '导演': x.dir || x.dirZh || x.dirEn || '', '主演': x.cast || '',
    '地区': countryZh(x.country), '片长': x.min || null, '类型': genresZh((x.genres || '').split(',').filter(Boolean)),
    '简介': x.synopsis || x.zhSynopsis || x.plot || '',
    'IMDb': tt ? `https://www.imdb.com/title/${tt}/` : '',
    '海报链接': x.posters?.[0] ? imgUrl(x.posters[0][0], 1000) : '',
  };
}
async function ensureInfo(tt) {
  if (!tt) return null;
  const old = info[tt];
  if (old?.v === 2) return old;
  if (old?.tried && Date.now() - old.tried < 6 * 3600e3) return old;   // 查不到的，6 小时后再试
  const x = await lookup(tt);
  if (!x) { info[tt] = { ...(old || {}), tried: Date.now() }; return info[tt]; }
  const keep = {}; for (const k of ['dir', 'synopsis']) if (old?.[k]) keep[k] = old[k];   // 人工写的不覆盖
  info[tt] = { ...(old || {}), ...x, ...keep, tried: x.v === 2 ? undefined : Date.now() };
  return info[tt];
}

let canWrite = !LOCAL, wrote = 0, writeErr = '';
const films = [];
const galleryDir = path.join(ROOT, 'site/gallery');
const posterDir = path.join(ROOT, 'site/posters');
const have = new Set((await fs.readdir(posterDir)).map(f => f.replace(/\.jpg$/, '')));
const IMG_H = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.imdb.com/' };

async function images(tt, x) {
  if (!tt || !x) return;
  const p0 = x.posters?.[0]?.[0];
  if (p0 && !have.has(tt)) {
    try {
      await download(imgUrl(p0, 500, 82), path.join(posterDir, tt + '.jpg'), IMG_H);
      await download(imgUrl(p0, 1100, 80), path.join(ROOT, 'site/posters-hd', tt + '.jpg'), IMG_H);
      have.add(tt);
    } catch (e) { console.warn('海报失败', tt, e.message); }
  }
  const want = Math.min(LOCAL_STILLS, x.stills?.length || 0);
  let n = 0;
  for (let i = 0; i < want; i++) {
    const f = path.join(galleryDir, tt, `${i + 1}.jpg`);
    if (await exists(f)) { n++; continue; }
    try { await download(imgUrl(x.stills[i][0], 1280, 76), f, IMG_H); n++; } catch (e) { console.warn('剧照失败', tt, i, e.message); break; }
  }
  x.local = n;
}

// Notion「剧照」栏里手动传的图 → site/gallery/u/<页面id>/
async function userShots(id, files) {
  const dir = path.join(galleryDir, 'u', id), out = [];
  const keep = new Set();
  for (const f of files || []) {
    const url = f.file?.url || f.external?.url; if (!url) continue;
    const stable = f.type === 'file' ? url.split('?')[0] : url;      // Notion 的签名地址会变，去掉签名才稳定
    const name = crypto.createHash('sha1').update(stable).digest('hex').slice(0, 12) + '.jpg';
    keep.add(name);
    const file = path.join(dir, name);
    if (!await exists(file)) {
      try {
        const buf = await download(url, file);
        if (sharp) await fs.writeFile(file, await sharp(buf).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer());
      } catch (e) { console.warn('手动剧照失败', id, e.message); continue; }
    }
    out.push(`gallery/u/${id}/${name}`);
  }
  for (const old of await fs.readdir(dir).catch(() => [])) if (!keep.has(old)) await fs.rm(path.join(dir, old));
  return out;
}

if (LOCAL) {
  for (const s of window.FILM_SNAPSHOT) {
    const x = await ensureInfo(s.imdb); await images(s.imdb, x);
    films.push(s); process.stdout.write('.');
  }
} else {
  for (let i = 0; i < pages.length; i += 4) {
    await Promise.all(pages.slice(i, i + 4).map(async p => {
      const id = idOf(p), c = cache[id] || (cache[id] = {});
      const cur = n => { const v = prop(p, n); return v == null ? '' : v; };
      const title = String(cur('片名')).replace(/\*\*/g, '');
      let tt = (String(cur('IMDb')).match(/tt\d{6,9}/) || [])[0] || '';
      // 只填了片名：先找出是哪一部（找不到的 6 小时后再试）
      if (!tt && title && !(c.noMatch === title && Date.now() - (c.noMatchAt || 0) < 6 * 3600e3)) {
        tt = await resolveImdb(title, cur('年份') || undefined);
        if (tt) say(`🔎 《${title}》→ ${tt}`); else { c.noMatch = title; c.noMatchAt = Date.now(); say(`❓ 没找到《${title}》对应的电影，可以在 Notion 里贴上它的 IMDb 链接`); }
      }
      const x = await ensureInfo(tt);
      await images(tt, x);

      // 写回 Notion：只填空着的栏目；如果 IMDb 链接换成了另一部，之前自动填的也跟着换
      const auto = autoFields(x, tt), relinked = c.tt && tt && c.tt !== tt, filled = c.filled || {};
      const val = {}, patch = {};
      for (const [name, a] of Object.entries(auto)) {
        const now = cur(name), mine = relinked && filled[name] != null && String(filled[name]) === String(now);
        val[name] = now === '' || now === 0 || mine ? a : now;
        if ((now === '' || now === 0 || mine) && a !== '' && a != null && p.properties[name]) {
          const pv = propValue(p, name, a); if (pv) { patch[name] = pv; filled[name] = a; }
        }
      }
      if (tt) c.tt = tt;
      if (canWrite && tt && x && (Object.keys(patch).length || (!p.cover && auto['海报链接']))) {
        const body = { properties: patch };
        if (!p.cover && auto['海报链接']) body.cover = { type: 'external', external: { url: auto['海报链接'] } };
        try {
          await notion('PATCH', `/pages/${p.id}`, body); c.filled = filled; wrote++;
          say(`✍️ 《${val['片名'] || title}》补齐：${Object.keys(patch).join('、') || '封面'}`);
        } catch (e) {
          if (e.status === 403 || e.status === 401) { canWrite = false; writeErr = '集成没有写权限'; }
          else console.warn('写回失败', id, e.message.slice(0, 300));
        }
      }

      // 影评：页面没改过就用上次的
      if (c.edited !== p.last_edited_time || c.review == null) {
        try { c.review = await review(p.id); c.edited = p.last_edited_time; } catch (e) { console.warn('影评失败', id, e.message); }
      }
      const shots = await userShots(id, prop(p, '剧照'));
      films[pages.indexOf(p)] = {
        id, imdb: tt, title: val['片名'] || title || '（无名）', orig: val['原名'] ?? cur('原名'), en: val['英文名'] ?? cur('英文名'),
        year: (val['年份'] ?? cur('年份')) || null, group: cur('分组') || '我自己看的', cast: val['主演'] ?? cur('主演'), douban: cur('豆瓣'),
        line: cur('一句话'), stars: String(cur('我的评分')).length, watched: cur('观看日期'),
        dir: val['导演'] ?? cur('导演'), country: val['地区'] ?? cur('地区'), min: (val['片长'] ?? cur('片长')) || 0, genres: val['类型'] ?? cur('类型'),
        synopsis: val['简介'] ?? cur('简介'), review: c.review || '', ...(shots.length ? { shots } : {}),
      };
    }));
  }
  for (const id of Object.keys(cache)) if (!pages.some(p => idOf(p) === id)) delete cache[id];
}

/* ---------- 3. 写出 ---------- */
const FILM_INFO = {}, FILM_GALLERY = {};
for (const f of films) {
  const x = info[f.imdb]; if (!x) continue;
  FILM_INFO[f.imdb] = { dir: x.dir || x.dirZh || x.dirEn || '', min: x.min || 0, genres: x.genres || '', imdbRating: x.imdbRating || null,
    country: x.country || '', kind: x.kind || 'Movie', synopsis: x.synopsis || x.zhSynopsis || x.plot || '' };
  if (x.stills?.length || x.posters?.length) FILM_GALLERY[f.imdb] = { l: x.local || 0, s: x.stills || [], p: x.posters || [] };
}
const body = `window.FILM_SNAPSHOT = ${JSON.stringify(films)};\n` +
  `window.FILM_INFO = ${JSON.stringify(FILM_INFO)};\n` +
  `window.FILM_POSTERS = ${JSON.stringify([...have].sort())};\n` +
  `window.FILM_GALLERY = ${JSON.stringify(FILM_GALLERY)};\n`;
const dataFile = path.join(ROOT, 'site/data.js');
const old = await fs.readFile(dataFile, 'utf8').catch(() => '');
const oldAt = (old.match(/FILM_SYNCED_AT = "([^"]+)"/) || [])[1];
const sameBody = old.slice(old.indexOf('window.FILM_SNAPSHOT')) === body;
// 内容没变就不动文件（否则每 15 分钟都会白白发布一次）；每 20 天至少更新一次时间戳，保持仓库活跃
if (!sameBody || !oldAt || LOCAL || Date.now() - Date.parse(oldAt) > 20 * 864e5) {
  const at = LOCAL && oldAt ? oldAt : new Date().toISOString();
  await fs.writeFile(dataFile, '// 由 scripts/sync.mjs 生成，勿手改\n' + `window.FILM_SYNCED_AT = ${JSON.stringify(at)};\n` + body);
}
const stable = o => JSON.stringify(o, null, 2) + '\n';
await fs.writeFile(path.join(ROOT, 'data/info.json'), stable(info));
if (!LOCAL) {
  await fs.writeFile(path.join(ROOT, 'data/order.json'), stable(pages.map(idOf)));
  await fs.writeFile(path.join(ROOT, 'data/pages.json'), stable(cache));
}
if (writeErr) say('⚠️ 资料已经查齐并显示在放映室里，但没能写回 Notion：这个集成只有读权限。到 notion.so/profile/integrations 打开这个集成 → 权限（Capabilities）→ 勾上「更新内容 / Update content」→ 保存，下次同步就会自动把空栏目填上。');
say(`✅ 同步完成：${films.length} 部，影评 ${films.filter(f => f.review).length} 篇，海报 ${have.size} 张，有剧照的 ${Object.values(FILM_GALLERY).filter(g => g.s.length).length} 部${wrote ? `，写回 Notion ${wrote} 行` : ''}`);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary.join('\n\n') + '\n');
// 留一份最近一次的同步记录在仓库里，方便排查
if (!LOCAL) await fs.writeFile(path.join(ROOT, 'data/last-sync.json'), stable({ ok: true, canWrite, wrote, films: films.length, notes: summary.filter(s => !s.startsWith('✅')) }));
