function playIntro(force) {
  if (!force && (sess.get('fy.intro') || reduced)) return;
  const run = ++introRun;
  const it = $('#intro'), cv = $('#introCv'), cx = cv.getContext('2d');
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
  const pool = films.filter(f => posterSrc(f) && !f.posterFile);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const credited = pool.filter(f => f.dir && f.year);
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
  const rest = pool.filter(f => !A.some(s => s.f === f));
  const B = take(rest, 6), C = take(rest, 3, 6), D = take(rest, 14, 9), E = take(rest, 7, 23);
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
      drawShot(s, i * pw + gut / 2, dy, pw - gut, h, 1.35 + p * .25, 0, (i - 1) * .02);
      cx.restore();
    });
    // 中间一格在后半段撑满全屏
    if (p > .62) {
      const q = easeInOut(clamp((p - .62) / .3, 0, 1)), mid = g.list[1] || g.list[0];
      const x = pw * (1 - q), ww = pw + (w - pw) * q;
      cx.save(); cx.beginPath(); cx.rect(x, 0, ww, h); cx.clip();
      drawShot(mid, x, 0, ww, h, 1.35 + p * .25);
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
    const ghosts = speed > h * .02 ? 4 : 1;
    for (let gk = 0; gk < ghosts; gk++) {
      cx.globalAlpha = ghosts > 1 ? .32 : 1;
      const yy = y - gk * speed * .5;
      list.forEach((s, i) => {
        const top = i * fh - yy; if (top > h || top + fh < 0) return;
        cx.save(); cx.beginPath(); cx.rect(x0, top, x1 - x0, h); cx.clip();
        drawShot(s, x0, top, x1 - x0, h, 1.1);
        cx.restore();
        cx.fillStyle = '#0b0806'; cx.fillRect(x0, top + h, x1 - x0, fh - h);   // 格线
      });
    }
    cx.globalAlpha = 1;
    vignette(.6); sprockets(x0, x1, -y * .5); noise(.45);
  }
  // 最后一格停住，被放映机的热度烧穿
  function burn(g, p) {
    const w = W(), h = H(), side = Math.max(w * .07, 28 * S), x0 = side, x1 = w - side;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h);
    const shake = p < .5 ? (Math.random() - .5) * 4 * S * p * 2 : 0;
    drawShot(g.s, x0 + shake, 0, x1 - x0, h, 1.1 + p * .05);
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

  const t0 = now();
  function tick(tt) {
    if (run !== introRun) return;
    if (cv.width !== Math.round(innerWidth * S)) fit();
    const t = tt - t0;
    if (t >= TOTAL) { endIntro(); return; }
    while (lastSeg < segs.length - 1 && t >= segs[lastSeg].t0 + segs[lastSeg].dur) lastSeg++;
    const g = segs[lastSeg], p = clamp((t - g.t0) / g.dur, 0, 1);
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
