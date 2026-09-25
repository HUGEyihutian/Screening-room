(() => {
'use strict';

// 开发自检用：地址带 #dev 时，动画帧改为手动推进（后台标签页里 rAF 会暂停），
// 用 __fyTick(帧数) 一次推进若干帧，每帧 16.7ms
let devRaf = null, devNow = null;
if (location.hash === '#dev') {
  let q = [], vt = performance.now();
  devRaf = cb => { q.push(cb); return q.length; };
  window.__fyTick = (n = 1) => { for (let k = 0; k < n; k++) { vt += 16.7; const cbs = q; q = []; cbs.forEach(cb => cb(vt)); } return q.length; };
  devNow = () => vt;
  const st = document.createElement('style');
  st.textContent = '*{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}';
  document.head.appendChild(st);
  window.__fySnap = async (name = 'snap', scale = 0.6) => {
    if (!window.html2canvas) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const cv = await html2canvas(document.body, { scale, backgroundColor: getComputedStyle(document.body).backgroundColor, logging: false, imageTimeout: 0, ignoreElements: n => (n.classList && n.classList.contains('cell') && n.style.visibility === 'hidden') || n.id === 'grain' || (n.hidden === true), width: innerWidth, height: innerHeight, windowWidth: innerWidth, windowHeight: innerHeight });
    await fetch('/snap?name=' + encodeURIComponent(name), { method: 'POST', body: cv.toDataURL('image/jpeg', 0.82) });
    return name;
  };
}
const raf = cb => devRaf ? devRaf(cb) : requestAnimationFrame(cb);
const now = () => devNow ? devNow() : performance.now();

/* ================= 常量 ================= */
const DS = 'collection://1099a947-bc2f-4a4c-a427-5c5f48738e36';
const DS_ID = '1099a947-bc2f-4a4c-a427-5c5f48738e36';
const NOTION = 'Notion';
const GROUPS = [
  { key: '一起想看', reel: '第一卷', no: 'REEL 1' },
  { key: '一起看过', reel: '第二卷', no: 'REEL 2' },
  { key: '我自己看的', reel: '第三卷', no: 'REEL 3' },
];
const GENRE = { Drama:'剧情', Crime:'犯罪', Mystery:'悬疑', Thriller:'惊悚', Romance:'爱情', Comedy:'喜剧', Fantasy:'奇幻',
  Action:'动作', Adventure:'冒险', History:'历史', War:'战争', Biography:'传记', Documentary:'纪录', Horror:'恐怖',
  Family:'家庭', Animation:'动画', Music:'音乐', 'Sci-Fi':'科幻', 'Film-Noir':'黑色电影' };
const COUNTRY = { TW:'中国台湾', CN:'中国大陆', HK:'中国香港', US:'美国', GB:'英国', FR:'法国', DE:'德国', IT:'意大利',
  KR:'韩国', JP:'日本', IR:'伊朗', GR:'希腊', GE:'格鲁吉亚', LV:'拉脱维亚', SUHH:'苏联' };
const INFO = window.FILM_INFO || {};
const POSTERS = new Set(window.FILM_POSTERS || []);
const ORDER = new Map((window.FILM_SNAPSHOT || []).map((f, i) => [f.id, i]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const sess = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};

/* ================= 数据 ================= */
let films = [];          // 当前片单（按卷+顺序排好）
let live = false;        // 是否连上 Notion
let mcp = null, sampleCap = null, assetsCap = null;

const imdbId = u => (String(u || '').match(/tt\d{6,9}/) || [])[0] || '';
const pageId = u => (String(u || '').replace(/-/g, '').match(/[0-9a-f]{32}(?=[^0-9a-f]*$)/i) || [])[0] || '';

function enrich(f) {
  const inf = INFO[f.imdb] || {};
  f.dir = f.dir || inf.dir || '';
  f.min = f.min || inf.min || 0;
  f.country = f.country || (inf.country ? (COUNTRY[inf.country] || inf.country) : '');
  f.genres = f.genres || (inf.genres ? inf.genres.split(',').map(g => GENRE[g] || g).join(' / ') : '');
  f.synopsis = f.synopsis || inf.synopsis || '';
  f.imdbRating = inf.imdbRating || null;
  f.kind = inf.kind || 'Movie';
  return f;
}
function fromSnapshot() {
  return (window.FILM_SNAPSHOT || []).map(s => enrich({
    id: s.id, imdb: s.imdb, title: s.title, orig: s.orig || '', en: s.en || '', year: s.year || null,
    group: s.group, cast: s.cast || '', douban: s.douban || '', line: s.line || '', stars: s.stars || 0, watched: s.watched || '',
    posterFile: '', seq: null, review: s.review || '', dir: s.dir || '', country: s.country || '', min: s.min || 0,
    genres: s.genres || '', synopsis: s.synopsis || '',
  }));
}
function snapshotStatus() {
  const t = window.FILM_SYNCED_AT;
  if (!t) return '离线片单（只读）';
  const d = new Date(t);
  return `每日同步自 Notion · ${d.getMonth() + 1}月${d.getDate()}日`;
}
function fromRow(r) {
  return enrich({
    id: pageId(r.url), imdb: imdbId(r.IMDb), title: String(r['片名'] || '').replace(/\*\*/g, '').trim() || '（无名）',
    orig: r['原名'] || '', en: r['英文名'] || '', year: r['年份'] || null, group: r['分组'] || '我自己看的',
    cast: r['主演'] || '', douban: r['豆瓣'] || '', line: r['一句话'] || '', stars: (r['我的评分'] || '').length,
    watched: r['date:观看日期:start'] || '', posterFile: r['海报文件'] || '', seq: r['序号'] ?? null,
    dir: r['导演'] || '', country: r['地区'] || '', min: r['片长'] || 0, genres: r['类型'] || '', synopsis: r['简介'] || '',
  });
}
function sortFilms(list) {
  const gi = g => { const i = GROUPS.findIndex(x => x.key === g); return i < 0 ? 9 : i; };
  const oi = f => ORDER.has(f.id) ? ORDER.get(f.id) : 1e6 + (f.seq || 0) / 1e6;
  return list.sort((a, b) => gi(a.group) - gi(b.group) || oi(a) - oi(b));
}
function posterSrc(f) {
  if (f.posterFile) return '/_blob/' + f.posterFile;
  if (f.imdb && POSTERS.has(f.imdb)) return 'posters/' + f.imdb + '.jpg';
  return '';
}
function fallbackHTML(f) {
  return `<div class="fallback"><div class="ft">${esc(f.title)}</div><div class="fm">${esc(f.year || '')}${f.dir ? '<br>' + esc(f.dir) : ''}</div></div>`;
}
function posterHTML(f, lazy = true) {
  const src = posterSrc(f);
  if (!src) return fallbackHTML(f);
  return `<img alt="${esc(f.title)} 海报" ${lazy && !devRaf ? 'loading="lazy"' : ''} decoding="async" src="${esc(src)}" onload="this.classList.add('ok')" onerror="this.replaceWith(Object.assign(document.createElement('div'),{innerHTML:${esc(JSON.stringify(fallbackHTML(f)))}}).firstChild)">`;
}
const groupOf = key => GROUPS.find(g => g.key === key) || GROUPS[2];
const fmtRuntime = m => m ? `${m} 分钟` : '';

/* ================= 胶片视图：布局 ================= */
const gate = $('#gate'), track = $('#track');
let entries = [];    // {type:'leader'|'film', film, group, x(center), w, node}
let filmEntries = []; // 只含影片的 entries
let geo = { ph: 400, pw: 267, band: 52, fx: 14, pitch: 295, fh: 504 };
let pos = 0, target = 0, vel = 0, lastPos = 0;   // pos = 视口中心对应的 track 坐标
let current = -1;    // 当前居中影片在 filmEntries 的下标

function measure() {
  // 视口可能暂时是 0（隐藏的框架、还没排版的 iframe），此时用保守尺寸，等 ResizeObserver 再量
  const vh = innerHeight || document.documentElement.clientHeight || 800;
  const vw = innerWidth || document.documentElement.clientWidth || 1200;
  const avail = (vh - 56 - 290) / 1.26;   // 留出字幕和走片条；1.26 = 画面 + 上下齿孔带
  let ph = Math.max(150, Math.min(avail, 470));
  if (vw < 520) ph = Math.max(150, Math.min(ph, vw * 0.78 * 1.5, 330));
  const pw = Math.round(ph * 2 / 3), band = Math.round(ph * 0.13), fx = Math.round(ph * 0.04);
  geo = { ph: Math.round(ph), pw, band, fx, pitch: pw + fx * 2, fh: Math.round(ph) + band * 2 };
  const r = document.documentElement.style;
  r.setProperty('--ph', geo.ph + 'px'); r.setProperty('--pw', geo.pw + 'px'); r.setProperty('--band', geo.band + 'px');
  r.setProperty('--fx', geo.fx + 'px'); r.setProperty('--fh', geo.fh + 'px');
}

function buildStrip() {
  const keepId = filmEntries[current]?.film.id;
  measure();
  track.textContent = '';
  entries = []; filmEntries = [];
  let x = 0, n = 0;
  const counts = {};
  films.forEach(f => counts[f.group] = (counts[f.group] || 0) + 1);
  GROUPS.forEach(g => {
    const list = films.filter(f => f.group === g.key);
    if (!list.length) return;
    const lw = Math.round(geo.pitch * 1.25);
    const lead = el('div', 'cell leader');
    lead.style.width = lw + 'px';
    lead.innerHTML = `<div class="perf t"></div><div class="perf b"></div>
      <div class="lead"><span class="cue"></span><span class="rl">${g.no}</span><span class="rn">${g.reel}</span>
      <span class="rg">${esc(g.key)}</span><span class="rc">${String(list.length).padStart(3, '0')} 格</span></div>`;
    entries.push({ type: 'leader', group: g.key, x: x + lw / 2, w: lw, node: lead });
    x += lw;
    list.forEach(f => {
      n++;
      const c = el('div', 'cell');
      c.style.width = geo.pitch + 'px';
      const code = String(n).padStart(3, '0');
      c.innerHTML = `<div class="perf t"></div><div class="perf b"></div>
        <div class="edge t"><span>◂ ${code}A</span><span>${esc(f.year || '')}</span></div>
        <div class="pic">${posterHTML(f)}</div>
        <div class="edge b"><span>放映室 5219</span><span>${code} ▸</span></div>`;
      const e = { type: 'film', film: f, group: g.key, x: x + geo.pitch / 2, w: geo.pitch, node: c, n };
      entries.push(e); filmEntries.push(e);
      x += geo.pitch;
    });
  });
  entries.forEach(e => { e.node.style.left = (e.x - e.w / 2) + 'px'; e.node.dataset.k = entries.indexOf(e); track.appendChild(e.node); });
  track.style.width = x + 'px';
  // 累计片长（按片单顺序）
  let cum = 0; filmEntries.forEach(e => { e.cum = cum; e.len = e.film.min || (e.film.kind === 'TVSeries' ? 50 : 110); cum += e.len; });
  // 恢复位置
  let idx = keepId ? filmEntries.findIndex(e => e.film.id === keepId) : -1;
  if (idx < 0) idx = Math.min(store.get('fy.idx', 0), filmEntries.length - 1);
  if (idx < 0) idx = 0;
  if (filmEntries[idx]) { pos = target = lastPos = filmEntries[idx].x; }
  current = -1;
  buildScrub();
  $('#brandSub').textContent = `三卷胶片 · ${films.length} 格`;
}

/* ================= 胶片视图：物理与特效 ================= */
let dragging = false, dragStartX = 0, dragStartPos = 0, dragMoved = 0, samples = [];
let wheelTimer = 0, idleT = 0;

function nearestFilm(p) {
  let best = 0, bd = Infinity;
  filmEntries.forEach((e, i) => { const d = Math.abs(e.x - p); if (d < bd) { bd = d; best = i; } });
  return best;
}
function goTo(i, instant) {
  i = Math.max(0, Math.min(filmEntries.length - 1, i));
  if (!filmEntries[i]) return;
  target = filmEntries[i].x;
  if (instant) pos = target;
}
function snap() { goTo(nearestFilm(target)); }

gate.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  dragging = true; dragMoved = 0; dragStartX = e.clientX; dragStartPos = pos; samples = [[e.clientX, now()]];
  target = pos; gate.setPointerCapture(e.pointerId); gate.classList.add('drag');
});
gate.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - dragStartX; dragMoved = Math.max(dragMoved, Math.abs(dx));
  target = pos = dragStartPos - dx;
  samples.push([e.clientX, now()]); if (samples.length > 6) samples.shift();
});
function endDrag(e) {
  if (!dragging) return;
  dragging = false; gate.classList.remove('drag');
  const a = samples[0], b = samples[samples.length - 1];
  const v = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;   // px/ms
  if (dragMoved < 6) { // 点击
    const hit = e.target.closest('.cell');
    if (hit) {
      const en = entries[+hit.dataset.k];
      if (en.type === 'film') {
        const i = filmEntries.indexOf(en);
        if (i === current && Math.abs(pos - en.x) < 4) openDetail(en.film, hit.querySelector('.pic'));
        else goTo(i);
      } else goTo(nearestFilm(en.x + en.w));
    }
    return;
  }
  target = pos - v * 380;          // 惯性
  snap();
}
gate.addEventListener('pointerup', endDrag);
gate.addEventListener('pointercancel', endDrag);
gate.addEventListener('wheel', e => {
  if (!$('#stripView').hidden) {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    target += d * (e.deltaMode === 1 ? 30 : 1) * 1.1;
    target = Math.max(filmEntries[0]?.x ?? 0, Math.min(filmEntries[filmEntries.length - 1]?.x ?? 0, target));
    clearTimeout(wheelTimer); wheelTimer = setTimeout(snap, 140);
  }
}, { passive: false });

const mblur = $('#mblurStd');
let lastBlur = -1;
function frame(t) {
  raf(frame);
  if ($('#stripView').hidden || !filmEntries.length) return;
  if (!dragging) pos += (target - pos) * (reduced ? 1 : 0.12);
  vel = pos - lastPos; lastPos = pos;
  const W = gate.clientWidth;
  // 胶片轨道
  const skew = reduced ? 0 : Math.max(-7, Math.min(7, vel * 0.09));
  const weave = reduced || Math.abs(vel) > 0.3 ? 0 : Math.sin(t / 420) * 0.35 + Math.sin(t / 97) * 0.15; // 片门抖动
  track.style.transform = `translate3d(${(W / 2 - pos).toFixed(2)}px,${weave.toFixed(2)}px,0) skewX(${(-skew).toFixed(2)}deg)`;
  // 横向动态模糊
  const blur = reduced ? 0 : Math.min(14, Math.abs(vel) * 0.35);
  const bq = Math.round(blur * 2) / 2;
  if (bq !== lastBlur) {
    lastBlur = bq; mblur.setAttribute('stdDeviation', `${bq} 0`);
    gate.style.filter = bq > 0.4 ? 'url(#mblur)' : '';
  }
  // 每一格贴在同一个大鼓面上：格与格首尾相接，两端向后弯去；离中心越远越暗
  const half = W / 2 + geo.pitch * 1.5;
  const R = Math.max(W * 1.15, 900);
  entries.forEach(e => {
    const dx = e.x - pos;
    const vis = Math.abs(dx) < half + e.w;
    if (vis !== e.vis) { e.vis = vis; e.node.style.visibility = vis ? '' : 'hidden'; }
    if (!vis) return;
    const ad = Math.min(Math.abs(dx / geo.pitch), 3);
    if (reduced) e.node.style.transform = '';
    else {
      const th = dx / R;
      const tx = R * Math.sin(th) - dx, tz = R * (Math.cos(th) - 1);
      e.node.style.transform = `translate3d(${tx.toFixed(2)}px,0,${tz.toFixed(2)}px) rotateY(${(th * 57.2958).toFixed(3)}deg)`;
    }
    const br = 1 - Math.min(ad, 1.6) * 0.4;
    e.node.style.filter = ad < 0.05 ? '' : `brightness(${br.toFixed(3)}) saturate(${(1 - Math.min(ad, 1) * 0.35).toFixed(3)})`;
  });
  // 当前格
  const i = nearestFilm(pos);
  if (i !== current) { current = i; updateCaption(); store.set('fy.idx', i); }
  updateTimecode();
  updateScrubHead();
}

/* ================= 字幕区 ================= */
function splitChars(s) { return [...s].map((c, i) => `<span class="ch" style="--d:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join(''); }
function updateCaption() {
  const e = filmEntries[current]; if (!e) return;
  const f = e.film, g = groupOf(f.group);
  $('#capReel').textContent = `${g.reel} · ${g.key}`;
  $('#capCount').textContent = `${String(e.n).padStart(3, '0')} / ${String(filmEntries.length).padStart(3, '0')}`;
  $('#capTitle').innerHTML = reduced ? esc(f.title) : splitChars(f.title);
  const bits = [];
  const alt = f.orig && f.orig !== f.title ? f.orig : f.en;
  if (alt) bits.push(`<i>${esc(alt)}</i>`);
  if (f.year) bits.push(esc(f.year));
  if (f.dir) bits.push(esc(f.dir));
  $('#capSub').innerHTML = bits.join('<span style="color:var(--ink-3)">　·　</span>');
  $('#capLine').textContent = f.line || '';
  $('#tcRight').textContent = f.stars ? '★'.repeat(f.stars) : (f.imdbRating ? `IMDb ${f.imdbRating}` : '');
}
function tc(mins) {
  const tot = mins * 60; const h = Math.floor(tot / 3600), m = Math.floor(tot % 3600 / 60), s = Math.floor(tot % 60), fr = Math.floor((tot % 1) * 24);
  return `${String(h).padStart(3, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
}
function updateTimecode() {
  // 位置在两格之间时按比例插值——走片时时间码会跟着跑
  let a = 0;
  for (let k = 0; k < filmEntries.length; k++) if (filmEntries[k].x <= pos) a = k;
  const e = filmEntries[a], nx = filmEntries[a + 1];
  let mins = e.cum;
  if (nx && pos > e.x) mins += e.len * Math.min(1, (pos - e.x) / (nx.x - e.x));
  $('#tcode').textContent = tc(Math.max(0, mins));
}

/* ================= 走片条 ================= */
const scrub = $('#scrub');
function buildScrub() {
  scrub.innerHTML = '';
  const N = filmEntries.length; if (!N) return;
  GROUPS.forEach(g => {
    const idx = filmEntries.map((e, i) => e.group === g.key ? i : -1).filter(i => i >= 0);
    if (!idx.length) return;
    const s = el('div', 'seg-r'); s.style.left = (idx[0] / N * 100) + '%'; s.style.width = (idx.length / N * 100) + '%';
    s.innerHTML = `<span>${g.reel}</span>`; scrub.appendChild(s);
  });
  filmEntries.forEach((e, i) => { const t = el('div', 'tick'); t.style.left = ((i + .5) / N * 100) + '%'; scrub.appendChild(t); });
  scrub.appendChild(el('div', 'head'));
}
function updateScrubHead() {
  const h = scrub.lastChild; if (!h || !filmEntries.length) return;
  const f0 = filmEntries[0].x, f1 = filmEntries[filmEntries.length - 1].x;
  const r = f1 > f0 ? (pos - f0) / (f1 - f0) : 0;
  const N = filmEntries.length;
  h.style.left = (((r * (N - 1)) + .5) / N * 100) + '%';
}
let scrubbing = false;
function scrubTo(e) {
  const r = scrub.getBoundingClientRect();
  const i = Math.floor((e.clientX - r.left) / r.width * filmEntries.length);
  goTo(i);
}
scrub.addEventListener('pointerdown', e => { scrubbing = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); });
scrub.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e); });
scrub.addEventListener('pointerup', () => scrubbing = false);

/* ================= 印样视图 ================= */
let reelFilter = 'all';
function buildChips() {
  const box = $('#reelChips'); box.innerHTML = '';
  [['all', '全部'], ...GROUPS.map(g => [g.key, g.key])].forEach(([k, label]) => {
    const b = el('button', 'chip', esc(label)); b.type = 'button';
    b.setAttribute('aria-pressed', String(reelFilter === k));
    b.onclick = () => { reelFilter = k; buildChips(); buildSheet(); };
    box.appendChild(b);
  });
}
function buildSheet() {
  const q = $('#q').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const sheet = $('#sheet'); sheet.innerHTML = '';
  let shown = 0;
  GROUPS.forEach(g => {
    if (reelFilter !== 'all' && reelFilter !== g.key) return;
    let list = films.map((f, i) => ({ f, n: i + 1 })).filter(x => x.f.group === g.key);
    const total = list.length;
    if (q) list = list.filter(({ f }) => [f.title, f.orig, f.en, f.dir, f.cast, String(f.year)].join(' ').toLowerCase().includes(q));
    if (sort === 'year') list.sort((a, b) => (a.f.year || 0) - (b.f.year || 0));
    if (sort === 'imdb') list.sort((a, b) => (b.f.imdbRating || 0) - (a.f.imdbRating || 0));
    if (sort === 'mine') list.sort((a, b) => (b.f.stars || 0) - (a.f.stars || 0));
    if (!list.length) return;
    shown += list.length;
    const sec = el('section', 'reelsec');
    sec.innerHTML = `<h2><span>${g.no}</span><b>${esc(g.key)}</b><em>${q ? `${list.length} / ${total}` : total} 格</em></h2>`;
    const grid = el('div', 'contact');
    grid.innerHTML = '<div class="perf t"></div><div class="perf b"></div>';
    list.forEach(({ f, n }) => {
      const b = el('button', 'shot'); b.type = 'button';
      b.innerHTML = `<span class="no">${String(n).padStart(3, '0')}A</span><div class="ph">${posterHTML(f)}</div>
        ${f.stars ? `<span class="mk">${'★'.repeat(f.stars)}</span>` : ''}<span class="nm">${esc(f.title)}</span>`;
      b.title = `${f.title}${f.year ? ' · ' + f.year : ''}${f.dir ? ' · ' + f.dir : ''}`;
      b.onclick = () => openDetail(f, b.querySelector('.ph'));
      grid.appendChild(b);
    });
    sec.appendChild(grid); sheet.appendChild(sec);
  });
  if (!shown) sheet.innerHTML = '<p class="empty">没有找到。换个关键词试试。</p>';
}
$('#q').addEventListener('input', buildSheet);
$('#sort').addEventListener('change', buildSheet);

function setView(v) {
  const strip = v === 'strip';
  $('#stripView').hidden = !strip; $('#sheetView').hidden = strip;
  $('#vStrip').setAttribute('aria-pressed', String(strip)); $('#vSheet').setAttribute('aria-pressed', String(!strip));
  if (!strip) buildSheet(); else { gate.focus({ preventScroll: true }); }
  store.set('fy.view', v);
}
$('#vStrip').onclick = () => setView('strip');
$('#vSheet').onclick = () => setView('sheet');

/* ================= 详情 ================= */
let dFilm = null, dDirty = false;
function renderStars(n) {
  const box = $('#dStars'); box.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = el('button', i <= n ? 'on' : '', '★'); b.type = 'button'; b.setAttribute('aria-label', `${i} 星`);
    b.onclick = () => { const v = dFilm.stars === i ? 0 : i; dFilm.stars = v; renderStars(v); markDirty(); };
    box.appendChild(b);
  }
}
function markDirty() { dDirty = true; $('#dNote').textContent = live ? '有改动，尚未保存' : ''; $('#dNote').className = 'note'; saveDraft(); }
function saveDraft() {
  if (!dFilm) return;
  store.set('fy.draft.' + dFilm.id, { review: $('#dReview').value, line: $('#dLine').value, stars: dFilm.stars, watched: $('#dDate').value, group: $('#dGroup').value });
}
['#dLine', '#dReview', '#dDate', '#dGroup'].forEach(s => $(s).addEventListener('input', markDirty));

async function openDetail(f, fromEl) {
  dFilm = f; dDirty = false;
  const d = $('#detail');
  const src = posterSrc(f);
  $('#dBg').style.backgroundImage = src ? `url("${src}")` : '';
  $('#dPoster').innerHTML = posterHTML(f, false);
  const img = $('#dPoster img'); if (img) img.classList.add('ok');
  const g = groupOf(f.group);
  $('#dReel').textContent = `${g.no} · ${g.reel} · ${g.key}`;
  $('#dTitle').textContent = f.title;
  $('#dOrig').textContent = [f.orig && f.orig !== f.title ? f.orig : '', f.en && f.en !== f.orig ? f.en : ''].filter(Boolean).join(' / ');
  const facts = [
    ['年份', f.year], ['导演', f.dir], ['主演', f.cast], ['地区', f.country], ['片长', f.kind === 'TVSeries' ? '剧集' : fmtRuntime(f.min)],
    ['类型', f.genres], ['IMDb', f.imdbRating ? `${f.imdbRating} / 10` : ''],
  ].filter(x => x[1]);
  $('#dFacts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  $('#dSyn').textContent = f.synopsis || '';
  const links = [];
  if (f.imdb) links.push(`<a href="https://www.imdb.com/title/${f.imdb}/" target="_blank" rel="noopener">IMDb 页面 ↗</a>`);
  if (f.douban) links.push(`<a href="${esc(f.douban)}" target="_blank" rel="noopener">豆瓣 ↗</a>`);
  else links.push(`<a href="https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(f.title)}" target="_blank" rel="noopener">在豆瓣搜索 ↗</a>`);
  links.push(`<a href="https://www.notion.so/${f.id}" target="_blank" rel="noopener">在 Notion 打开 ↗</a>`);
  $('#dLinks').innerHTML = links.join('');
  // 我的
  $('#dGroup').innerHTML = GROUPS.map(x => `<option ${x.key === f.group ? 'selected' : ''}>${x.key}</option>`).join('');
  $('#dDate').value = f.watched || '';
  $('#dLine').value = f.line || '';
  $('#dReview').value = '';
  renderStars(f.stars || 0);
  const draft = live ? store.get('fy.draft.' + f.id, null) : null;
  $('#dSave').disabled = !live;
  $('#dNote').className = 'note';
  $('#dNote').textContent = '';
  // 公开版 / 离线版：只读展示"我的"部分
  $('#dForm').hidden = !live; $('#dRO').hidden = live;
  if (!live) {
    const bits = [];
    if (f.stars) bits.push(`<span class="ro-stars">${'★'.repeat(f.stars)}<i>${'★'.repeat(5 - f.stars)}</i></span>`);
    if (f.watched) bits.push(`<span>${esc(f.watched.replace(/-/g, '.'))} 观看</span>`);
    $('#dROMeta').innerHTML = bits.join('');
    $('#dROLine').textContent = f.line || '';
    const rv = (f.review || '').trim();
    $('#dROReview').innerHTML = rv ? rv.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p class="ro-empty">还没写影评。</p>';
    $('#dROEdit').href = `https://www.notion.so/${f.id}`;
  }
  d.hidden = false; d.classList.remove('on');
  $('#dShell').scrollTop = 0;
  flipIn(fromEl);
  raf(() => d.classList.add('on'));
  $('#dClose').focus({ preventScroll: true });
  if (live) {
    $('#dReview').placeholder = '正在从 Notion 读取影评……';
    try {
      const txt = await loadReview(f);
      if (dFilm !== f) return;
      $('#dReview').value = txt;
      $('#dReview').placeholder = '写点什么……';
    } catch (err) {
      if (dFilm !== f) return;
      $('#dReview').placeholder = '写点什么……';
      $('#dNote').className = 'note err'; $('#dNote').textContent = '影评读取失败：' + errText(err);
    }
  }
  if (draft && (draft.review || draft.line !== (f.line || '') || draft.stars !== (f.stars || 0))) {
    if (draft.review && draft.review !== $('#dReview').value) {
      $('#dReview').value = draft.review; $('#dLine').value = draft.line; dFilm.stars = draft.stars; renderStars(draft.stars);
      if (draft.watched) $('#dDate').value = draft.watched;
      $('#dNote').className = 'note'; $('#dNote').textContent = '已恢复上次没保存的草稿';
      dDirty = true;
    }
  }
}
function flipIn(fromEl) {
  const to = $('#dPoster');
  if (!fromEl || reduced) return;
  const a = fromEl.getBoundingClientRect(), b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const sx = a.width / b.width, sy = a.height / b.height;
  to.animate([
    { transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${sx},${sy})`, transformOrigin: '0 0', filter: 'brightness(1.4)' },
    { transform: 'none', transformOrigin: '0 0', filter: 'none' },
  ], { duration: 700, easing: 'cubic-bezier(.2,.75,.15,1)' });
}
function closeDetail() {
  if (dDirty && live) saveDraft();
  const d = $('#detail'); d.classList.remove('on'); d.hidden = true; dFilm = null;
  if (!$('#stripView').hidden) gate.focus({ preventScroll: true });
}
function stepDetail(dir) {
  if (!dFilm) return;
  if (dDirty) saveDraft();
  const i = films.indexOf(dFilm); const nf = films[(i + dir + films.length) % films.length];
  const k = filmEntries.findIndex(e => e.film === nf); if (k >= 0) goTo(k, true);
  openDetail(nf, null);
}
$('#dClose').onclick = closeDetail;
$('#dPrev').onclick = () => stepDetail(-1);
$('#dNext').onclick = () => stepDetail(1);
$('#openBtn').onclick = () => { const e = filmEntries[current]; if (e) openDetail(e.film, e.node.querySelector('.pic')); };

$('#dSave').onclick = async () => {
  if (!dFilm || !live) return;
  const f = dFilm, btn = $('#dSave'), note = $('#dNote');
  btn.disabled = true; note.className = 'note'; note.textContent = '正在写入 Notion……'; setStatus('busy', '写入中');
  const props = {
    '一句话': $('#dLine').value.trim(),
    '我的评分': f.stars ? '★'.repeat(f.stars) : null,
    '分组': $('#dGroup').value,
  };
  if ($('#dDate').value) { props['date:观看日期:start'] = $('#dDate').value; props['date:观看日期:is_datetime'] = 0; }
  else props['date:观看日期:start'] = null;
  try {
    await callNotion('notion-update-page', { page_id: f.id, command: 'update_properties', properties: props });
    await callNotion('notion-update-page', { page_id: f.id, command: 'replace_content', new_str: '## 影评\n\n' + $('#dReview').value.trim() + '\n' });
    const regroup = f.group !== props['分组'];
    f.line = props['一句话']; f.group = props['分组']; f.watched = $('#dDate').value;
    reviewCache.set(f.id, $('#dReview').value.trim()); f.review = $('#dReview').value.trim();
    store.del('fy.draft.' + f.id); dDirty = false;
    const t = new Date(); note.textContent = `已保存到 Notion · ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    setStatus('live', `Notion 已同步 · ${films.length} 部`);
    if (regroup) { sortFilms(films); buildStrip(); }
    updateCaption(); if (!$('#sheetView').hidden) buildSheet();
  } catch (err) {
    note.className = 'note err'; note.textContent = '没保存上：' + errText(err) + '（草稿已留在本机）';
    saveDraft(); setStatus('err', 'Notion 写入失败');
  } finally { btn.disabled = !live; }
};

/* ================= Notion ================= */
const reviewCache = new Map();
function errText(e) {
  const c = e && e.code;
  const map = {
    needs_reauth: 'Notion 授权过期了。到 claude.ai 设置 → 连接器 里重新连接 Notion，再刷新本页。',
    server_not_connected: '没找到 Notion 连接器。到 claude.ai 设置 → 连接器 添加 Notion。',
    selection_required: '你连了不止一个 Notion，请在弹出的选择框里选一个。',
    not_in_manifest: '这个页面还没被允许使用 Notion。刷新后在提示里点允许。',
    consent_required: '这个页面还没被允许使用 Notion。',
    blocked_by_policy: '组织策略不允许在这里使用 Notion。',
    server_unavailable: 'Notion 暂时没有响应，稍后再试。',
    tool_error: 'Notion 拒绝了这次操作：' + (e && e.message || ''),
  };
  return map[c] || ((e && e.message) || String(e));
}
async function callNotion(tool, input, opts) {
  const r = await mcp.callTool(NOTION, tool, input, opts);
  return r.payload ?? r;
}
async function loadReview(f) {
  if (reviewCache.has(f.id)) return reviewCache.get(f.id);
  const p = await callNotion('notion-fetch', { id: f.id }, { cache: false });
  const text = typeof p === 'string' ? p : (p && (p.text || p.content)) || '';
  const m = text.match(/<content>([\s\S]*?)<\/content>/);
  let body = (m ? m[1] : '').replace(/<empty-block\/>/g, '').trim();
  body = body.replace(/^##\s*影评\s*\n?/, '').trim();
  body = body.replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, '$1');
  reviewCache.set(f.id, body); f.review = body;
  return body;
}
function setStatus(s, t) { $('#status').dataset.s = s; $('#statusText').textContent = t; }

async function queryAll() {
  const base = { mode: 'rows', data_source_url: DS, limit: 100 };
  const p1 = await callNotion('notion-query-data-sources', { data: base }, { cache: false });
  let rows = (p1 && p1.results) || [];
  if (p1 && p1.has_more) {   // 超过 100 部时：再按片名倒序取一次合并
    const p2 = await callNotion('notion-query-data-sources', { data: { ...base, sort: [{ property: '片名', direction: 'descending' }] } }, { cache: false });
    const seen = new Set(rows.map(r => r.url));
    ((p2 && p2.results) || []).forEach(r => { if (!seen.has(r.url)) rows.push(r); });
  }
  return rows;
}
async function syncNotion(manual) {
  if (!mcp) return;
  setStatus('busy', '正在读取 Notion');
  try {
    let rows;
    try { rows = await queryAll(); }
    catch (err) {
      if (err && err.retryable) { await new Promise(r => setTimeout(r, (err.retryAfterMs || 1500) + Math.random() * 800)); rows = await queryAll(); }
      else throw err;
    }
    const list = rows.map(fromRow).filter(f => f.id);
    if (!list.length) throw { message: 'Notion 里没有读到任何电影' };
    films = sortFilms(list); live = true;
    buildStrip(); if (!$('#sheetView').hidden) buildSheet();
    setStatus('live', `Notion 已同步 · ${films.length} 部`);
    $('#addBtn').disabled = false;
    if (manual) toast('已从 Notion 重新读取');
  } catch (err) {
    live = false;
    setStatus('err', ({ needs_reauth: 'Notion 需要重新连接', server_not_connected: '未连接 Notion', not_in_manifest: '未允许访问 Notion' }[err && err.code]) || '离线片单（只读）');
    toast(errText(err), 6000);
  }
}

/* ================= 添加 ================= */
let aPosterFile = null;
function openAdd() {
  const f = $('#addForm'); f.reset(); aPosterFile = null;
  $('#aGroup').innerHTML = GROUPS.map(g => `<option ${g.key === '我自己看的' ? 'selected' : ''}>${g.key}</option>`).join('');
  $('#aDate').value = new Date().toISOString().slice(0, 10);
  $('#aThumb').innerHTML = ''; $('#aNote').textContent = ''; $('#aNote').className = 'note';
  $('#aPosterNote').textContent = assetsCap ? '可选。不传就用片名做一张字卡。' : '这个环境不能上传海报，会用片名做一张字卡。';
  $('#aPoster').disabled = !assetsCap;
  $('#aFill').disabled = !sampleCap;
  if (!sampleCap) { $('#aNote').textContent = '这个环境不能自动补全，请手动填写。'; }
  $('#addDlg').hidden = false; $('#aTitle').focus();
}
$('#addBtn').onclick = () => {
  if (!live) { toast('需要先连上 Notion 才能添加（现在是离线片单）', 4500); return; }
  openAdd();
};
$('#aCancel').onclick = () => { $('#addDlg').hidden = true; };
$('#aGroup').addEventListener('change', () => { if ($('#aGroup').value === '一起想看') $('#aDate').value = ''; });
$('#aPoster').addEventListener('change', e => {
  aPosterFile = e.target.files[0] || null;
  $('#aThumb').innerHTML = aPosterFile ? `<img alt="" src="${URL.createObjectURL(aPosterFile)}">` : '';
});
$('#aFill').onclick = async () => {
  const title = $('#aTitle').value.trim();
  if (!title) { $('#aNote').className = 'note err'; $('#aNote').textContent = '先填片名'; $('#aTitle').focus(); return; }
  const btn = $('#aFill'); btn.disabled = true;
  $('#aNote').className = 'note'; $('#aNote').textContent = 'Claude 正在翻资料……';
  const year = $('#aYear').value.trim();
  const prompt = `你是一个严谨的电影资料员。请根据你的知识，为下面这部电影整理资料，只输出一个 JSON 对象，不要任何多余文字。
片名：${title}${year ? `\n年份（用户提供）：${year}` : ''}${$('#aDir').value ? `\n导演（用户提供）：${$('#aDir').value}` : ''}
如果同名作品不止一部，优先选择艺术电影/影史上更知名的那一部。
字段：
{"title":"常用中文片名","orig":"原语言片名（与中文名相同时给空字符串）","en":"英文片名","year":数字,
 "director":"导演的常用中文译名","cast":"两位主演，用英文逗号分隔，用常见英文拼写","country":"国家或地区，中文",
 "minutes":数字,"genres":"类型，中文，用 / 分隔","imdb":"IMDb 编号如 tt0118694；不确定就给空字符串，绝不要猜",
 "synopsis":"中文简介，60 到 90 字，不剧透"}
不确定的字段给空字符串或 null。`;
  try {
    const r = await sampleCap.json(prompt, { modelTier: 'default' });
    const set = (id, v) => { if (v != null && v !== '' && !$(id).value) $(id).value = v; };
    if (r.title && r.title !== title) $('#aTitle').value = r.title;
    set('#aYear', r.year); set('#aOrig', r.orig); set('#aEn', r.en); set('#aDir', r.director); set('#aCast', r.cast);
    set('#aCountry', r.country); set('#aMin', r.minutes); set('#aGenres', r.genres); set('#aSyn', r.synopsis);
    if (r.imdb && /^tt\d{6,9}$/.test(r.imdb)) set('#aImdb', `https://www.imdb.com/title/${r.imdb}/`);
    $('#aNote').textContent = '已补全。这是 Claude 凭记忆写的，请核对一下。';
  } catch (err) {
    $('#aNote').className = 'note err';
    $('#aNote').textContent = err && err.code === 'not_granted' ? '没有获得使用 Claude 的许可，请手动填写。' : '自动补全失败：' + ((err && err.message) || err);
  } finally { btn.disabled = false; }
};
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const title = $('#aTitle').value.trim();
  if (!title) { $('#aNote').className = 'note err'; $('#aNote').textContent = '片名不能为空'; return; }
  const btn = $('#aSave'); btn.disabled = true; $('#aNote').className = 'note';
  try {
    let posterId = '';
    if (aPosterFile && assetsCap) {
      $('#aNote').textContent = '正在上传海报……';
      const up = await assetsCap.upload(aPosterFile);
      posterId = up.id;
    }
    $('#aNote').textContent = '正在写入 Notion……';
    const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    const imdbUrl = $('#aImdb').value.trim();
    const props = {
      '片名': title, '分组': $('#aGroup').value, '原名': $('#aOrig').value.trim(), '英文名': $('#aEn').value.trim(),
      '年份': num($('#aYear').value), '导演': $('#aDir').value.trim(), '主演': $('#aCast').value.trim(),
      '地区': $('#aCountry').value.trim(), '片长': num($('#aMin').value), '类型': $('#aGenres').value.trim(),
      '简介': $('#aSyn').value.trim(), '一句话': $('#aLine').value.trim(), '序号': Date.now(),
    };
    if (imdbUrl) props['IMDb'] = imdbUrl;
    if (posterId) props['海报文件'] = posterId;
    if ($('#aDate').value) { props['date:观看日期:start'] = $('#aDate').value; props['date:观看日期:is_datetime'] = 0; }
    Object.keys(props).forEach(k => { if (props[k] === '' || props[k] == null) delete props[k]; });
    const res = await callNotion('notion-create-pages', { parent: { data_source_id: DS_ID }, pages: [{ properties: props, content: '## 影评\n\n' }] });
    const pg = res && res.pages && res.pages[0];
    const f = enrich({
      id: pageId(pg && (pg.id || pg.url)), imdb: imdbId(imdbUrl), title, orig: props['原名'] || '', en: props['英文名'] || '',
      year: props['年份'], group: props['分组'], cast: props['主演'] || '', douban: '', line: props['一句话'] || '', stars: 0,
      watched: $('#aDate').value, posterFile: posterId, seq: props['序号'], dir: props['导演'] || '', country: props['地区'] || '',
      min: props['片长'] || 0, genres: props['类型'] || '', synopsis: props['简介'] || '',
    });
    films.push(f); sortFilms(films); buildStrip();
    if (!$('#sheetView').hidden) buildSheet();
    $('#addDlg').hidden = true;
    setView('strip');
    const k = filmEntries.findIndex(x => x.film === f); goTo(k);
    toast(`《${title}》已经接进第${groupOf(f.group).reel.slice(1)}，也写进了 Notion`);
    setStatus('live', `Notion 已同步 · ${films.length} 部`);
  } catch (err) {
    $('#aNote').className = 'note err';
    $('#aNote').textContent = '没保存上：' + (err && err.code ? errText(err) : ((err && err.message) || err));
  } finally { btn.disabled = false; }
});

/* ================= 杂项 UI ================= */
let toastT = 0;
function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
function setRoom(r) { document.documentElement.dataset.room = r; store.set('fy.room', r); }
$('#roomBtn').onclick = () => setRoom(document.documentElement.dataset.room === 'light' ? 'dark' : 'light');
$('#menuBtn').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; $('#menuBtn').setAttribute('aria-expanded', String(!m.hidden)); };
document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });
$('#mIntro').onclick = () => { $('#menu').hidden = true; playIntro(true); };
$('#mSync').onclick = () => { $('#menu').hidden = true; if (mcp) syncNotion(true); else toast('这个环境连不到 Notion，显示的是离线片单'); };
$('#mKeys').onclick = () => { $('#menu').hidden = true; };

document.addEventListener('keydown', e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (!$('#intro').hidden) return endIntro();
    if (!$('#addDlg').hidden) { $('#addDlg').hidden = true; return; }
    if (!$('#detail').hidden) return closeDetail();
  }
  if (inField) return;
  if (!$('#detail').hidden) {
    if (e.key === 'ArrowLeft') stepDetail(-1);
    if (e.key === 'ArrowRight') stepDetail(1);
    return;
  }
  if (!$('#addDlg').hidden || !$('#intro').hidden) return;
  if (e.key === 'g' || e.key === 'G') setView($('#stripView').hidden ? 'strip' : 'sheet');
  if ($('#stripView').hidden) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); goTo(nearestFilm(target) + 1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(nearestFilm(target) - 1); }
  if (e.key === 'Home') goTo(0);
  if (e.key === 'End') goTo(filmEntries.length - 1);
  if (e.key === 'Enter') $('#openBtn').click();
});
let rsT = 0, lastSize = '';
function onResize() {
  const s = innerWidth + 'x' + innerHeight;
  if (s === lastSize || !innerWidth || !innerHeight) return;
  lastSize = s; clearTimeout(rsT); rsT = setTimeout(buildStrip, 120);
}
addEventListener('resize', onResize);
if (window.ResizeObserver) new ResizeObserver(onResize).observe(document.documentElement);

/* ================= 颗粒与划痕 ================= */
(function grain() {
  const cv = $('#grain'), cx = cv.getContext('2d');
  const W = cv.width, H = cv.height, img = cx.createImageData(W, H);
  let last = 0, scratch = 0, scratchX = 0;
  function draw(t) {
    raf(draw);
    if (document.hidden || t - last < 42) return; last = t;   // 约 24 格/秒
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    cx.putImageData(img, 0, 0);
    if (reduced) return;
    // 偶发的灰尘与划痕
    if (Math.random() < 0.05) scratch = 4 + Math.random() * 10 | 0, scratchX = Math.random() * W;
    if (scratch > 0) { scratch--; cx.fillStyle = 'rgba(255,255,255,.9)'; cx.fillRect(scratchX + (Math.random() - .5) * 2, 0, 1, H); }
    if (Math.random() < 0.12) { cx.fillStyle = Math.random() < .5 ? '#000' : '#fff'; cx.beginPath(); cx.arc(Math.random() * W, Math.random() * H, Math.random() * 1.6 + .4, 0, 7); cx.fill(); }
  }
  raf(draw);
})();

/* ================= 声音：背景乐 + 唱片机 ================= */
const FX = window.FySound || null;
const snd = {
  fx: FX,
  unlock() { try { return FX ? FX.unlock() : false; } catch { return false; } },
  on() { return !!(FX && FX.unlocked); },
  pref() { return store.get('fy.bgm', true); },
  bgmAuto() { if (snd.pref() && !spPlaying && snd.unlock()) FX.bgmStart(); syncSoundBtn(); },
};
let spPlaying = false;
function syncSoundBtn() { $('#soundBtn').setAttribute('aria-pressed', String(!!(FX && FX.bgmOn))); }
$('#soundBtn').onclick = () => {
  if (!FX) { toast('这个浏览器不支持网页音频'); return; }
  snd.unlock();
  if (FX.bgmOn) { FX.bgmStop(); store.set('fy.bgm', false); toast('背景音乐已关'); }
  else { FX.bgmStart(); store.set('fy.bgm', true); toast('背景音乐：夜场'); }
  syncSoundBtn();
};
// 没看片头（本次会话看过了）时，第一次点击页面就开始背景乐
document.addEventListener('pointerdown', function first(e) {
  if (!$('#intro').hidden) return;
  document.removeEventListener('pointerdown', first, true);
  if (!e.target.closest('#soundBtn')) setTimeout(() => snd.bgmAuto(), 200);
}, true);

// 唱片机：Spotify。公开网站里直接嵌播放器；在 Claude 里（不能嵌外站）就给一个打开链接
const SP_DEFAULT = 'https://open.spotify.com/playlist/6uM9ayCvEL8j1Xp1QNeRES';   // 香港电影的热门配乐
const inClaude = !!(window.claude && typeof window.claude.use === 'function');
function spParse(u) {
  const m = String(u || '').trim().match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(playlist|album|track|artist|episode|show)[\/:]([A-Za-z0-9]{10,40})/);
  return m ? { type: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
}
let spCtl = null, spApiLoading = false, spApi = null;
function spRender() {
  const it = spParse(store.get('fy.spotify', SP_DEFAULT)) || spParse(SP_DEFAULT);
  $('#spOpen').href = it.url;
  $('#spNow').textContent = { playlist: '歌单', album: '专辑', track: '单曲', artist: '艺人', episode: '单集', show: '播客' }[it.type] + ' · ' + it.id.slice(0, 8) + '…';
  const box = $('#spEmbed');
  if (inClaude) {
    box.innerHTML = ''; $('#spNote').textContent = '在 Claude 里不能嵌入 Spotify 播放器。点"在 Spotify 打开"，或到公开网站上用。';
    return;
  }
  $('#spNote').textContent = '';
  const h = it.type === 'track' || it.type === 'episode' ? 152 : 352;
  if (spApi) {           // 官方 iFrame API：能知道你是否在播放，好让背景乐自动让位
    box.innerHTML = '<div id="spMount"></div>';
    spApi.createController($('#spMount'), { uri: it.uri, width: '100%', height: h, theme: 'dark' }, ctl => {
      spCtl = ctl;
      ctl.addListener('playback_update', e => {
        const playing = e && e.data && !e.data.isPaused;
        if (playing && !spPlaying && FX && FX.bgmOn) { FX.bgmStop(1.2); syncSoundBtn(); }
        spPlaying = !!playing;
      });
    });
  } else {
    box.innerHTML = `<iframe title="Spotify 播放器" src="https://open.spotify.com/embed/${it.type}/${it.id}?theme=0" height="${h}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
  }
}
function spEnsureApi(done) {
  if (inClaude || spApi || spApiLoading) return done();
  spApiLoading = true;
  const timer = setTimeout(done, 4000);   // 加载不到 API 就退回普通嵌入
  window.onSpotifyIframeApiReady = api => { spApi = api; clearTimeout(timer); done(); };
  const s = document.createElement('script'); s.src = 'https://open.spotify.com/embed/iframe-api/v1'; s.async = true;
  s.onerror = () => { clearTimeout(timer); done(); };
  document.head.appendChild(s);
}
$('#spBtn').onclick = e => {
  e.stopPropagation();
  const p = $('#spPanel'), open = p.hidden;
  p.hidden = !open; $('#spBtn').setAttribute('aria-expanded', String(open));
  if (open && !p.dataset.ready) { p.dataset.ready = '1'; spEnsureApi(spRender); }
};
document.addEventListener('click', e => { if (!e.target.closest('#spPanel') && !e.target.closest('#spBtn')) { $('#spPanel').hidden = true; $('#spBtn').setAttribute('aria-expanded', 'false'); } });
$('#spForm').addEventListener('submit', e => {
  e.preventDefault();
  const it = spParse($('#spUrl').value);
  if (!it) { $('#spNote').textContent = '没认出来。请粘贴 open.spotify.com 开头的歌单、专辑或单曲链接。'; return; }
  store.set('fy.spotify', it.url); $('#spUrl').value = ''; spRender(); toast('唱片机换上了新唱片');
});
$('#spReset').onclick = () => { store.del('fy.spotify'); spRender(); };

/* ================= 片头 ================= */
let introRun = 0;
function endIntro() {
  const it = $('#intro'); if (it.hidden) return;
  introRun++;
  it.classList.add('out');
  sess.set('fy.intro', '1');
  $('#iGate').hidden = true;
  if (snd.on()) { snd.fx.stopAllSfx(); setTimeout(() => snd.bgmAuto(), 1500); }
  // 胶片从右侧"显影"进场
  if (!reduced && filmEntries.length) { pos = target + innerWidth * 0.9; }
  setTimeout(() => { it.hidden = true; it.classList.remove('out'); }, 1150);
  gate.focus({ preventScroll: true });
}
$('#skip').onclick = () => { snd.unlock(); endIntro(); };

function playIntro(force) {
  if (!force && (sess.get('fy.intro') || reduced)) return;
  const it = $('#intro'), cv = $('#introCv'), cx = cv.getContext('2d');
  // 浏览器只允许用户点一下之后才出声音：自动播放前先停在"入场"
  if (!force) {
    it.hidden = false; it.classList.remove('out');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
    $('#iTitle').classList.remove('on'); $('#iGate').hidden = false;
    $('#enterBtn').onclick = () => { $('#iGate').hidden = true; snd.unlock(); playIntro(true); };
    $('#enterBtn').focus({ preventScroll: true });
    return;
  }
  $('#iGate').hidden = true; snd.unlock();
  if (FX && FX.bgmOn) { FX.bgmStop(.6); syncSoundBtn(); }
  const run = ++introRun;
  it.hidden = false; it.classList.remove('out');
  $('#iTitle').classList.remove('on');
  $('#iSub').textContent = `三卷胶片 · ${films.length} 格`;
  let S = 1;                                   // 画布像素 / CSS 像素（限制在 1600 宽以内保证流畅）
  const fit = () => { S = Math.min(devicePixelRatio || 1, 1600 / Math.max(1, innerWidth)); cv.width = Math.round(innerWidth * S); cv.height = Math.round(innerHeight * S); };
  fit();
  const W = () => cv.width, H = () => cv.height;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = p => 1 - Math.pow(1 - p, 3), easeInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const GRADE = 'contrast(1.18) saturate(.82) sepia(.18) brightness(.94)';

  // —— 选片：有海报的，打乱；每个镜头一张 ——
  // 按人工分级挑镜头：2 = 主镜头（脸、眼睛、人影），1 = 可用，0 = 满版文字不用；新片没分级算 1
  const FOC = window.FILM_FOCAL || {};
  const tier = f => FOC[f.imdb] ? FOC[f.imdb][2] : 1;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const seen = new Set();
  const all = films.filter(f => posterSrc(f) && !f.posterFile && f.imdb && !seen.has(f.imdb) && seen.add(f.imdb));
  const heroes = shuffle(all.filter(f => tier(f) === 2)), goods = shuffle(all.filter(f => tier(f) === 1));
  const pool = [...heroes, ...goods];
  const credited = heroes.filter(f => f.dir && f.year);
  const uniq = new Map();
  function shot(f) {
    if (uniq.has(f.id)) return Object.assign({}, uniq.get(f.id));
    const sh = { f, im: new Image(), lo: new Image(), focal: { x: .5, y: .38 }, focalDone: false };
    sh.lo.src = posterSrc(f);
    sh.im.src = 'posters-hd/' + f.imdb + '.jpg';
    uniq.set(f.id, sh); return Object.assign({}, sh);
  }
  const take = (list, n, from = 0) => list.slice(from, from + n).map(shot);
  const A = take(credited, 3);                                   // 慢镜头：带片名字幕
  const restH = heroes.filter(f => !A.some(s => s.f === f));
  const B = take(restH, 6), C = take(restH, 3, 6);
  const mixed = shuffle([...restH.slice(16), ...goods]);
  const D = take(mixed, 14), E = take(restH, 7, 9);   // 走片和最后被烧穿的都用主镜头
  const hero = E[E.length - 1] || B[0];
  // 字体预热（Google Fonts 按字切片，提前加载要用到的字）
  try {
    const txt = [...A, ...B].map(s => `${s.f.dir}${s.f.title}`).join('') + '导演放映室';
    document.fonts.load(`900 40px "Noto Serif SC"`, txt); document.fonts.load(`italic 40px "Instrument Serif"`, '0123456789');
    document.fonts.load(`500 12px "IBM Plex Mono"`, 'REEL0123456789');
  } catch {}

  // 找画面焦点：人脸肤色 + 局部反差最高的区域（避开海报底部的字）
  function focalOf(sh) {
    if (sh.focalDone) return sh.focal;
    if (FOC[sh.f.imdb]) { sh.focalDone = true; return (sh.focal = { x: FOC[sh.f.imdb][0], y: FOC[sh.f.imdb][1] }); }
    const im = ready(sh.lo) ? sh.lo : null; if (!im) return sh.focal;
    const src = uniq.get(sh.f.id); src.focalDone = sh.focalDone = true;
    try {
      const gw = 20, gh = 30, c = document.createElement('canvas'); c.width = gw; c.height = gh;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, gw, gh);
      const d = x.getImageData(0, 0, gw, gh).data, L = [], K = [];
      for (let i = 0; i < gw * gh; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        L.push(.3 * r + .59 * g + .11 * b);
        K.push(r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15 ? 1 : 0);
      }
      let best = -1, bx = 10, by = 11;
      for (let j = 3; j < gh - 9; j++) for (let i = 2; i < gw - 2; i++) {
        let s = 0, s2 = 0, k = 0;
        for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const q = (j + v) * gw + i + u; s += L[q]; s2 += L[q] * L[q]; k += K[q]; }
        const sd = Math.sqrt(Math.max(0, s2 / 25 - (s / 25) ** 2));
        const score = sd / 55 + k / 25 * 1.4 - Math.abs(i - gw / 2) / gw * .4;
        if (score > best) { best = score; bx = i; by = j; }
      }
      src.focal = sh.focal = { x: (bx + .5) / gw, y: (by + .5) / gh };
    } catch { /* 本地文件打开时画布会被"污染"，就用默认焦点 */ }
    return sh.focal;
  }
  function ready(im) { return im && im.complete && im.naturalWidth > 0; }
  // 画一个"镜头"：从海报里按焦点截取与画框同比例的一块，z 越大推得越近
  function drawShot(sh, bx, by, bw, bh, z, px = 0, py = 0, grade = GRADE) {
    const im = ready(sh.im) ? sh.im : ready(sh.lo) ? sh.lo : null;
    if (!im) { cx.fillStyle = '#050403'; cx.fillRect(bx, by, bw, bh); return; }
    const fo = focalOf(sh), iw = im.naturalWidth, ih = im.naturalHeight, a = bw / bh;
    let cw, ch; if (iw / ih > a) { ch = ih; cw = ih * a; } else { cw = iw; ch = iw / a; }
    cw /= z; ch /= z;
    const sx = clamp(fo.x * iw + px * iw - cw / 2, 0, iw - cw), sy = clamp(fo.y * ih + py * ih - ch / 2, 0, ih - ch);
    cx.imageSmoothingQuality = 'high';
    cx.filter = grade; cx.drawImage(im, sx, sy, cw, ch, bx, by, bw, bh); cx.filter = 'none';
  }
  function scope() { const w = W(), h = H(), fh = Math.min(h * .82, w / 2.39); return { x: 0, y: (h - fh) / 2, w, h: fh }; }
  function noise(alpha, n = 110) {
    for (let k = 0; k < n; k++) { cx.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * alpha})`; cx.fillRect(Math.random() * W(), Math.random() * H(), 1.6 * S, 1.6 * S); }
    if (Math.random() < .3) { cx.fillStyle = `rgba(255,255,255,${.12 + Math.random() * .22})`; cx.fillRect(Math.random() * W(), 0, S, H()); }
  }
  function vignette(a) {
    const g = cx.createRadialGradient(W() / 2, H() / 2, Math.min(W(), H()) * .22, W() / 2, H() / 2, Math.max(W(), H()) * .72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); cx.fillStyle = g; cx.fillRect(0, 0, W(), H());
  }
  function sprockets(x0, x1, scroll) {   // 两侧竖向齿孔
    const s = Math.min(W(), H()) * .028, gap = s * 1.8;
    cx.fillStyle = '#16110b'; cx.fillRect(0, 0, x0, H()); cx.fillRect(x1, 0, W() - x1, H());
    cx.fillStyle = '#000';
    for (let y = ((scroll ?? now() * .6) % gap + gap) % gap - gap; y < H(); y += gap) {
      [x0 / 2, x1 + (W() - x1) / 2].forEach(cxp => { cx.beginPath(); cx.roundRect ? cx.roundRect(cxp - s * .45, y, s * .9, s * .65, s * .15) : cx.rect(cxp - s * .45, y, s * .9, s * .65); cx.fill(); });
    }
  }
  function text(str, x, y, font, color, align = 'left', base = 'alphabetic') {
    cx.font = font; cx.fillStyle = color; cx.textAlign = align; cx.textBaseline = base; cx.fillText(str, x, y);
  }
  // 字幕重击：从大到小砸下来，带一点红青错位
  function slam(str, p, italic) {
    const w = W(), h = H();
    const k = p < .16 ? 1.45 - easeOut(p / .16) * .45 : 1 - (p - .16) * .04;
    const size = (italic ? Math.min(w * .19, h * .42) : Math.min(w * .09, h * .2)) * k;
    const font = italic ? `italic ${size}px "Instrument Serif", serif` : `900 ${size}px "Noto Serif SC", serif`;
    const sp = p < .16 ? (1 - p / .16) * 14 * S : 2 * S;
    cx.save(); cx.globalCompositeOperation = 'lighter';
    text(str, w / 2 - sp, h / 2, font, 'rgba(255,40,30,.55)', 'center', 'middle');
    text(str, w / 2 + sp, h / 2, font, 'rgba(30,200,255,.45)', 'center', 'middle');
    cx.restore();
    text(str, w / 2, h / 2, font, 'rgba(246,238,222,.96)', 'center', 'middle');
  }

  // —— 剪辑表（毫秒）——
  const segs = []; let T = 0;
  const add = (dur, kind, data = {}) => { segs.push({ t0: T, dur, kind, ...data }); T += dur; };
  add(1300, 'warm');
  add(2400, 'leader');
  A.forEach((s, i) => { add(1250, 'slow', { s, i, z: rnd(1.9, 2.3), px: rnd(-.06, .06), py: rnd(-.04, .03) }); add(140, 'black'); });
  const bDur = [600, 520, 440, 370, 310, 260];
  B.forEach((s, i) => {
    add(120, 'whip', { a: i ? B[i - 1] : A[A.length - 1], b: s, dir: i % 2 ? -1 : 1 });
    add(bDur[i], 'build', { s, i, z: rnd(1.5, 2.6), px: rnd(-.08, .08), scope: i % 2 === 0,
      slam: i % 2 === 1 ? (i % 4 === 1 ? { str: String(s.f.year || ''), it: true } : { str: s.f.dir || s.f.title, it: false }) : null });
  });
  add(1050, 'split', { list: C });
  const dDur = [120, 110, 100, 95, 90, 85, 80, 75, 72, 70, 72, 80, 95, 120];
  D.forEach((s, i) => add(dDur[i] || 80, 'rapid', { s, i, z: rnd(1.25, 2.4), px: rnd(-.1, .1), py: rnd(-.08, .08), flash: i % 4 === 2 }));
  add(1250, 'run', { list: E });
  add(900, 'burn', { s: hero });
  add(3000, 'title');
  const TOTAL = T;
  // 预加载：慢镜头先加载，余下按顺序
  let lastSeg = 0;

  // —— 各种镜头的画法 ——
  function warm(p) {
    const w = W(), h = H();
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    // 放映机灯泡打火：不规则的闪烁，越来越稳
    const on = p > .25 && (Math.random() < p * .9);
    if (on) {
      const g = cx.createRadialGradient(w / 2, h * .45, 0, w / 2, h * .45, Math.max(w, h) * .6);
      const a = .06 + p * .14 * Math.random();
      g.addColorStop(0, `rgba(255,236,196,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g; cx.fillRect(0, 0, w, h);
    }
    if (p > .45) {
      const a = Math.min(1, (p - .45) / .3);
      text('放 映 室', w / 2, h / 2 - 6 * S, `500 ${13 * S}px "IBM Plex Mono", "Noto Serif SC", monospace`, `rgba(224,169,74,${a * .9})`, 'center', 'middle');
      text('本 场 放 映  ·  三 卷', w / 2, h / 2 + 18 * S, `400 ${10 * S}px "IBM Plex Mono", monospace`, `rgba(168,158,140,${a * .7})`, 'center', 'middle');
    }
    noise(.5, 60);
  }
  function leader(t) {
    const per = 800, n = 3 - Math.floor(t / per), p = (t % per) / per;
    const w = W(), h = H(), jx = (Math.random() - .5) * 3 * S, jy = (Math.random() - .5) * 3 * S;
    const side = Math.max(w * .06, 24 * S), x0 = side, x1 = w - side;
    cx.save(); cx.translate(jx, jy);
    const flick = .9 + Math.random() * .1;
    cx.fillStyle = `rgb(${190 * flick | 0},${182 * flick | 0},${166 * flick | 0})`; cx.fillRect(x0, 0, x1 - x0, h);
    const r = Math.min(x1 - x0, h) * .36, ccx = w / 2, ccy = h / 2;
    cx.fillStyle = 'rgba(40,32,24,.38)'; cx.beginPath(); cx.moveTo(ccx, ccy); cx.arc(ccx, ccy, r * 1.9, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); cx.closePath(); cx.fill();
    cx.strokeStyle = '#1a140e'; cx.lineWidth = 2.2 * S;
    cx.beginPath(); cx.arc(ccx, ccy, r, 0, 7); cx.stroke();
    cx.beginPath(); cx.arc(ccx, ccy, r * .82, 0, 7); cx.stroke();
    cx.beginPath(); cx.moveTo(x0, ccy); cx.lineTo(x1, ccy); cx.moveTo(ccx, 0); cx.lineTo(ccx, h); cx.stroke();
    text(String(Math.max(1, n)), ccx, ccy + r * .04, `500 ${r * 1.15}px "IBM Plex Mono", monospace`, '#120d08', 'center', 'middle');
    noise(.5); vignette(.75);
    cx.restore();
    sprockets(x0, x1);
  }
  function slow(g, p) {
    const w = W(), h = H(), sc = scope();
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    const z = g.z + p * .3;
    drawShot(g.s, sc.x, sc.y, sc.w, sc.h, z, g.px * (1 - p), g.py + p * .02);
    if (p < .12) { cx.fillStyle = `rgba(0,0,0,${1 - p / .12})`; cx.fillRect(sc.x, sc.y, sc.w, sc.h); }
    if (p > .88) { cx.fillStyle = `rgba(0,0,0,${(p - .88) / .12})`; cx.fillRect(sc.x, sc.y, sc.w, sc.h); }
    vignette(.55);
    const a = clamp((p - .18) / .2, 0, 1) * (p > .85 ? (1 - p) / .15 : 1);
    const lx = sc.x + sc.w * .06, ly = sc.y + sc.h - sc.h * .12;
    text(`导演　${g.s.f.dir}`, lx, ly - 30 * S, `500 ${11 * S}px "IBM Plex Mono", "Noto Serif SC", monospace`, `rgba(224,169,74,${a * .95})`);
    text(g.s.f.title, lx, ly, `900 ${Math.min(34 * S, sc.h * .085)}px "Noto Serif SC", serif`, `rgba(242,234,218,${a})`);
    text(String(g.s.f.year), lx + cx.measureText(g.s.f.title).width + 14 * S, ly, `italic ${Math.min(26 * S, sc.h * .065)}px "Instrument Serif", serif`, `rgba(242,234,218,${a * .75})`);
    noise(.3);
  }
  function whip(g, p) {
    const w = W(), h = H(), e = easeInOut(p), off = e * w * g.dir;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    // 用多次半透明偏移叠画模拟甩镜拖影
    for (let k = 0; k < 7; k++) {
      const d = (k - 3) * w * .035 * g.dir;
      cx.globalAlpha = .2;
      drawShot(g.a, -off + d, 0, w, h, 1.6, 0, 0, 'brightness(1.1) ' + GRADE);
      drawShot(g.b, w * g.dir - off + d, 0, w, h, 1.6, 0, 0, 'brightness(1.1) ' + GRADE);
    }
    cx.globalAlpha = 1;
    noise(.3);
  }
  function build(g, p) {
    const w = W(), h = H();
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    const punch = p < .2 ? 1.22 - easeOut(p / .2) * .22 : 1;
    const z = g.z * punch + p * .12;
    const sc = g.scope ? scope() : { x: 0, y: 0, w, h };
    const jx = p < .2 ? (Math.random() - .5) * 8 * S : 0;
    drawShot(g.s, sc.x + jx, sc.y, sc.w, sc.h, z, g.px, 0);
    vignette(.6);
    if (g.slam && g.slam.str) { cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fillRect(0, 0, w, h); slam(g.slam.str, p, g.slam.it); }
    if (p < .06) { cx.fillStyle = 'rgba(255,246,228,.7)'; cx.fillRect(0, 0, w, h); }
    noise(.35);
  }
  function split(g, p) {
    const w = W(), h = H(), n = g.list.length || 1, pw = w / n, gut = 6 * S;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    g.list.forEach((s, i) => {
      const pi = clamp((p - i * .09) / .35, 0, 1), e = easeOut(pi);
      const dy = (1 - e) * h * (i % 2 ? -1 : 1);
      cx.save(); cx.beginPath(); cx.rect(i * pw + gut / 2, 0, pw - gut, h); cx.clip();
      drawShot(s, i * pw + gut / 2, dy, pw - gut, h, 1.9 + p * .25, 0, (i - 1) * .02);
      cx.restore();
    });
    // 中间一格在后半段撑满全屏
    if (p > .62) {
      const q = easeInOut(clamp((p - .62) / .3, 0, 1)), mid = g.list[1] || g.list[0];
      const x = pw * (1 - q), ww = pw + (w - pw) * q;
      cx.save(); cx.beginPath(); cx.rect(x, 0, ww, h); cx.clip();
      drawShot(mid, x, 0, ww, h, 1.9 + p * .25);
      cx.restore();
    }
    vignette(.55); noise(.35);
  }
  function rapid(g, p) {
    const w = W(), h = H();
    drawShot(g.s, 0, 0, w, h, g.z + p * .15, g.px, g.py);
    vignette(.5);
    if (g.flash && p < .4) { cx.fillStyle = 'rgba(255,248,232,.85)'; cx.fillRect(0, 0, w, h); }
    if (g.i % 5 === 3) text(`${String(films.indexOf(g.s.f) + 1).padStart(3, '0')}A`, w - 30 * S, h - 26 * S, `500 ${12 * S}px "IBM Plex Mono", monospace`, 'rgba(224,169,74,.9)', 'right');
    noise(.4);
  }
  // 胶片在片门里飞速走过，逐渐减速，停在最后一格
  function runFilm(g, p) {
    const w = W(), h = H(), list = g.list, n = list.length;
    const side = Math.max(w * .07, 28 * S), x0 = side, x1 = w - side, fh = h * 1.04;
    const travel = (n - 1) * fh, y = travel * (1 - Math.pow(1 - easeOut(p), 1.6));
    const speed = travel * (1 - p) * .04;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    // 快的时候画面带竖向残影；格线只在最后画一次，不跟着残影重复
    const ghosts = speed > h * .02 ? 3 : 1;
    const frames = yy => list.forEach((s, i) => {
      const top = i * fh - yy; if (top > h || top + fh < 0) return;
      cx.save(); cx.beginPath(); cx.rect(x0, top, x1 - x0, h); cx.clip();
      drawShot(s, x0, top, x1 - x0, h, 1.7);
      cx.restore();
    });
    frames(y);
    for (let gk = 1; gk < ghosts; gk++) { cx.globalAlpha = .28 / gk; frames(y - gk * speed * .6); }
    cx.globalAlpha = 1;
    list.forEach((s, i) => { const top = i * fh - y; cx.fillStyle = '#0b0806'; cx.fillRect(x0, top + h, x1 - x0, fh - h); });
    vignette(.6); sprockets(x0, x1, -y * .5); noise(.45);
  }
  // 最后一格停住，被放映机的热度烧穿
  function burn(g, p) {
    const w = W(), h = H(), side = Math.max(w * .07, 28 * S), x0 = side, x1 = w - side;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    const shake = p < .5 ? (Math.random() - .5) * 4 * S * p * 2 : 0;
    drawShot(g.s, x0 + shake, 0, x1 - x0, h, 1.7 + p * .05);
    vignette(.6); sprockets(x0, x1, 0);
    const bx = w * .6, by = h * .42, R = Math.hypot(w, h) * easeOut(clamp((p - .12) / .8, 0, 1)) * 1.05;
    if (R > 1) {
      const gr = cx.createRadialGradient(bx, by, 0, bx, by, R);
      gr.addColorStop(0, 'rgba(255,255,250,1)'); gr.addColorStop(.42, 'rgba(255,238,190,1)');
      gr.addColorStop(.62, 'rgba(255,150,50,.95)'); gr.addColorStop(.76, 'rgba(120,34,6,.85)'); gr.addColorStop(.8, 'rgba(0,0,0,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, w, h);
    }
    if (p > .85) { cx.fillStyle = `rgba(255,252,244,${(p - .85) / .15})`; cx.fillRect(0, 0, w, h); }
    noise(.35);
  }
  function title(t) {
    const w = W(), h = H();
    const k = clamp(t / 450, 0, 1);
    cx.fillStyle = `rgb(${(255 * (1 - k)) | 0},${(252 * (1 - k)) | 0},${(244 * (1 - k)) | 0})`; cx.fillRect(0, 0, w, h);
    if (t > 300) $('#iTitle').classList.add('on');
    noise(.25); vignette(.9);
  }

  // —— 声音：在每个镜头切换的那一刻打点 ——
  let cuedSeg = -1;
  function cue(g, prev) {
    if (!snd.on()) return;
    const fx = snd.fx;
    switch (g.kind) {
      case 'slow': if (g.i === 0) { fx.droneOn(3); fx.projectorLevel(.22, 1); } fx.tick(.12); break;
      case 'whip': fx.whoosh(.16, .55); break;
      case 'build': fx.hit(g.slam ? 1 : .8, !!g.slam); if (g.i === 0) fx.droneSwell(.18, 900, 3); break;
      case 'split': [0, 90, 180].forEach(d => setTimeout(() => fx.whoosh(.12, .4), d)); fx.riser(2.3); break;
      case 'rapid': g.flash ? fx.flash() : fx.tick(.24); if (g.i === 0) fx.hit(.5); break;
      case 'run': fx.projectorLevel(.7, .05); fx.projectorRate(3.2, .05); setTimeout(() => fx.projectorRate(.35, 1.1), 60); fx.droneSwell(.26, 2600, 1.2); break;
      case 'burn': fx.burn(.9); fx.projectorOff(.8); break;
      case 'title': fx.droneOff(.04); fx.projectorOff(.04); setTimeout(() => fx.titleChord(), 380); break;
    }
  }
  const t0 = now();
  function tick(tt) {
    if (run !== introRun) return;
    if (cv.width !== Math.round(innerWidth * S)) fit();
    const t = tt - t0;
    if (t >= TOTAL) { endIntro(); return; }
    while (lastSeg < segs.length - 1 && t >= segs[lastSeg].t0 + segs[lastSeg].dur) lastSeg++;
    const g = segs[lastSeg], p = clamp((t - g.t0) / g.dur, 0, 1);
    if (lastSeg !== cuedSeg) { cuedSeg = lastSeg; cue(g, segs[lastSeg - 1]); }
    if (g.kind === 'warm' && snd.on()) {   // 灯泡打火两次，然后放映机转起来
      if (!g.s1 && p > .28) { g.s1 = 1; snd.fx.lampStrike(); }
      if (!g.s2 && p > .5) { g.s2 = 1; snd.fx.lampStrike(); snd.fx.projectorOn(.45); }
    }
    if (g.kind === 'leader' && snd.on()) { const n = Math.floor((t - g.t0) / 800); if (n !== g.lastN) { g.lastN = n; snd.fx.beep(n === 1 ? 1000 : 800, n === 1 ? .14 : .06, n === 1 ? .7 : .3); } }
    const wv = (g.kind === 'slow' || g.kind === 'build') ? Math.sin(tt / 60) * .6 * S : 0;   // 片门轻微抖动
    cx.save(); cx.translate(0, wv);
    switch (g.kind) {
      case 'warm': warm(p); break;
      case 'leader': leader(t - g.t0); break;
      case 'slow': slow(g, p); break;
      case 'black': cx.fillStyle = '#000'; cx.fillRect(0, 0, W(), H()); noise(.3, 40); break;
      case 'whip': whip(g, p); break;
      case 'build': build(g, p); break;
      case 'split': split(g, p); break;
      case 'rapid': rapid(g, p); break;
      case 'run': runFilm(g, p); break;
      case 'burn': burn(g, p); break;
      case 'title': title(t - g.t0); break;
    }
    cx.restore();
    raf(tick);
  }
  raf(tick);
}

/* ================= 启动 ================= */
setRoom(store.get('fy.room', 'dark'));
films = sortFilms(fromSnapshot());
buildStrip(); buildChips();
setView(store.get('fy.view', 'strip'));
$('#addBtn').disabled = false;
raf(frame);
playIntro(false);

(async () => {
  const cl = window.claude;
  if (!cl || typeof cl.use !== 'function') { setStatus('off', snapshotStatus()); $('#addBtn').hidden = true; return; }
  const [m, s, a] = await Promise.all(['mcp', 'sample', 'assets'].map(n => cl.use(n).catch(() => null)));
  mcp = m; sampleCap = s; assetsCap = a;
  if (!mcp) { setStatus('off', snapshotStatus()); $('#addBtn').hidden = true; return; }
  syncNotion(false);
})();
})();
