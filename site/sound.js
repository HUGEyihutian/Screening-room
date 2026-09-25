// 放映室的声音：全部用 Web Audio 现场合成，不用任何录音素材。
// 片头音效（放映机、倒计时、甩镜、重击、上升音、烧片、片名和弦）+ 放映厅里的生成式背景乐。
(() => {
'use strict';
let ac = null, master, sfxBus, bgmBus, verb, noiseBuf, clatterBuf;

function ctx() {
  if (ac) return ac;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ac = new AC();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  master = ac.createGain(); master.gain.value = .9; master.connect(comp); comp.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
  bgmBus = ac.createGain(); bgmBus.gain.value = 0; bgmBus.connect(master);
  // 合成混响：指数衰减的噪声脉冲
  verb = ac.createConvolver(); const len = ac.sampleRate * 3.2, ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb.buffer = ir; const vg = ac.createGain(); vg.gain.value = .55; verb.connect(vg); vg.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  // 放映机：每秒 24 下的齿轮咔嗒 + 马达嗡声 + 风扇嘶声，一秒一循环
  clatterBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  { const d = clatterBuf.getChannelData(0), sr = ac.sampleRate;
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * .035 + Math.sin(2 * Math.PI * 50 * i / sr) * .05 + Math.sin(2 * Math.PI * 100 * i / sr) * .02;
    for (let k = 0; k < 24; k++) { const s = Math.floor(k * sr / 24), a = .35 + Math.random() * .3; for (let j = 0; j < 260; j++) d[s + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 45); } }
  return ac;
}
const t = () => ac.currentTime;
function noise(dest, dur, when = t()) { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(dest); s.start(when, Math.random()); s.stop(when + dur + .05); return s; }
function env(g, when, a, peak, d, end = 0.0001) { g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(peak, when + a); g.gain.exponentialRampToValueAtTime(end, when + a + d); }
function osc(type, f, dest, when, dur) { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, when); o.connect(dest); o.start(when); o.stop(when + dur + .05); return o; }

const S = {
  unlocked: false,
  unlock() { if (!ctx()) return false; if (ac.state !== 'running') ac.resume(); S.unlocked = true; return true; },

  /* ——— 片头音效 ——— */
  projector: null,
  projectorOn(level = .5) {
    if (!ac || S.projector) return;
    const s = ac.createBufferSource(); s.buffer = clatterBuf; s.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = .6;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t()); g.gain.exponentialRampToValueAtTime(level, t() + .8);
    s.connect(bp); bp.connect(g); g.connect(sfxBus); s.playbackRate.value = .55; s.playbackRate.linearRampToValueAtTime(1, t() + 1.2); s.start();
    S.projector = { s, g };
  },
  projectorRate(r, sec = .3) { if (S.projector) S.projector.s.playbackRate.linearRampToValueAtTime(r, t() + sec); },
  projectorLevel(v, sec = .3) { if (S.projector) S.projector.g.gain.linearRampToValueAtTime(Math.max(.0001, v), t() + sec); },
  projectorOff(sec = .2) { if (!S.projector) return; const p = S.projector; S.projector = null; p.g.gain.cancelScheduledValues(t()); p.g.gain.setValueAtTime(p.g.gain.value, t()); p.g.gain.linearRampToValueAtTime(.0001, t() + sec); p.s.stop(t() + sec + .05); },
  lampStrike() {   // 灯泡打火的"噗"一声
    const g = ac.createGain(); const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    noise(f, .25); f.connect(g); g.connect(sfxBus); env(g, t(), .005, .5, .22);
    const o = osc('sine', 70, g, t(), .3); o.frequency.exponentialRampToValueAtTime(40, t() + .25);
  },
  beep(f = 1000, dur = .08, v = .25) { const g = ac.createGain(); g.connect(sfxBus); osc('sine', f, g, t(), dur); env(g, t(), .004, v, dur); },
  whoosh(dur = .14, v = .5) {
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(300, t()); f.frequency.exponentialRampToValueAtTime(3800, t() + dur * .7); f.frequency.exponentialRampToValueAtTime(900, t() + dur);
    const g = ac.createGain(); noise(f, dur + .1); f.connect(g); g.connect(sfxBus); g.connect(verb);
    g.gain.setValueAtTime(.0001, t()); g.gain.exponentialRampToValueAtTime(v, t() + dur * .55); g.gain.exponentialRampToValueAtTime(.0001, t() + dur + .08);
  },
  hit(v = .8, big = false) {   // 低频重击 + 噪声冲击
    const g = ac.createGain(); g.connect(sfxBus); g.connect(verb);
    const o = osc('sine', big ? 150 : 120, g, t(), .7); o.frequency.exponentialRampToValueAtTime(big ? 34 : 45, t() + .45);
    env(g, t(), .003, v, big ? .9 : .5);
    const ng = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = big ? 2400 : 1600;
    noise(lp, .2); lp.connect(ng); ng.connect(sfxBus); env(ng, t(), .002, v * .5, .12);
  },
  tick(v = .22) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500; const g = ac.createGain(); noise(f, .04); f.connect(g); g.connect(sfxBus); env(g, t(), .001, v, .03); },
  flash() { S.beep(3200 + Math.random() * 800, .03, .08); },
  drone: null,
  droneOn(sec = 2) {   // 低沉的弦乐般持续音
    if (S.drone) return;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 3;
    const g = ac.createGain(); g.gain.setValueAtTime(.0001, t()); g.gain.exponentialRampToValueAtTime(.11, t() + sec);
    lp.connect(g); g.connect(sfxBus); g.connect(verb);
    const os = [73.42, 73.9, 110, 146.83].map(f => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    S.drone = { os, g, lp };
  },
  droneSwell(to = .45, cutoff = 1600, sec = 3) { if (!S.drone) return; S.drone.g.gain.linearRampToValueAtTime(to, t() + sec); S.drone.lp.frequency.exponentialRampToValueAtTime(cutoff, t() + sec); S.drone.os.forEach((o, i) => o.detune.linearRampToValueAtTime(i * 7 + 30, t() + sec)); },
  droneOff(sec = .05) { if (!S.drone) return; const d = S.drone; S.drone = null; d.g.gain.cancelScheduledValues(t()); d.g.gain.setValueAtTime(d.g.gain.value, t()); d.g.gain.linearRampToValueAtTime(.0001, t() + sec); d.os.forEach(o => o.stop(t() + sec + .05)); },
  riser(dur = 2.4) {
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(400, t()); f.frequency.exponentialRampToValueAtTime(6000, t() + dur);
    const g = ac.createGain(); noise(f, dur); f.connect(g); g.connect(sfxBus); g.gain.setValueAtTime(.0001, t()); g.gain.exponentialRampToValueAtTime(.35, t() + dur); g.gain.linearRampToValueAtTime(.0001, t() + dur + .05);
  },
  burn(dur = .9) {   // 胶片烧穿：噼啪 + 越来越大的轰鸣，然后戛然而止
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t()); lp.frequency.exponentialRampToValueAtTime(5000, t() + dur);
    const g = ac.createGain(); noise(lp, dur); lp.connect(g); g.connect(sfxBus); g.connect(verb);
    g.gain.setValueAtTime(.0001, t()); g.gain.exponentialRampToValueAtTime(.7, t() + dur * .95); g.gain.linearRampToValueAtTime(.0001, t() + dur + .02);
    for (let i = 0; i < 14; i++) { const w = t() + Math.random() * dur * .9; const cg = ac.createGain(); const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; noise(hp, .03, w); hp.connect(cg); cg.connect(sfxBus); env(cg, w, .001, .25 + Math.random() * .3, .025); }
  },
  titleChord() {   // 片名：一记温暖的和弦，慢慢散开
    const notes = [146.83, 220, 277.18, 329.63, 440, 554.37];   // D 大九
    notes.forEach((f, i) => {
      const g = ac.createGain(); g.connect(sfxBus); g.connect(verb);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; lp.connect(g);
      ['triangle', 'sine'].forEach((ty, k) => { const o = osc(ty, f * (k ? 2 : 1), lp, t() + i * .04, 5.5); o.detune.value = (Math.random() - .5) * 8; });
      g.gain.setValueAtTime(.0001, t() + i * .04); g.gain.exponentialRampToValueAtTime(.12 - i * .012, t() + .6 + i * .04); g.gain.exponentialRampToValueAtTime(.0001, t() + 5.2);
    });
  },
  stopAllSfx() { S.projectorOff(.3); S.droneOff(.3); },

  /* ——— 放映厅背景乐：生成式的夜场氛围 ——— */
  bgmOn: false, bgmTimer: 0, bgmNext: 0, bgmChord: 0,
  bgmStart() {
    if (!S.unlock() || S.bgmOn) return;
    S.bgmOn = true;
    bgmBus.gain.cancelScheduledValues(t()); bgmBus.gain.setValueAtTime(bgmBus.gain.value, t()); bgmBus.gain.linearRampToValueAtTime(.8, t() + 4);
    // 放映厅里若有若无的放映机和底噪
    if (!S.room) {
      const s = ac.createBufferSource(); s.buffer = clatterBuf; s.loop = true; s.playbackRate.value = 1;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; const g = ac.createGain(); g.gain.value = .06;
      s.connect(lp); lp.connect(g); g.connect(bgmBus); s.start(); S.room = { s, g };
    }
    S.bgmNext = t() + .3;
    S.bgmTimer = setInterval(S.bgmSchedule, 250);
    S.bgmSchedule();
  },
  bgmStop(sec = 1.5) {
    if (!ac || !S.bgmOn) return;
    S.bgmOn = false; clearInterval(S.bgmTimer);
    bgmBus.gain.cancelScheduledValues(t()); bgmBus.gain.setValueAtTime(bgmBus.gain.value, t()); bgmBus.gain.linearRampToValueAtTime(.0001, t() + sec);
    if (S.room) { const r = S.room; S.room = null; r.s.stop(t() + sec + .1); }
  },
  // 和弦走向：Fmaj7 → Em7 → Dm9 → Cmaj7(add9)，每个 9 秒，偶尔落一两个"钢琴"音
  CHORDS: [[87.31, 174.61, 220, 261.63, 329.63], [82.41, 164.81, 196, 246.94, 293.66], [73.42, 146.83, 174.61, 220, 329.63], [65.41, 130.81, 196, 246.94, 293.66]],
  SCALE: [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51],
  bgmSchedule() {
    if (!S.bgmOn) return;
    while (S.bgmNext < t() + 1) {
      const when = S.bgmNext, ch = S.CHORDS[S.bgmChord++ % S.CHORDS.length], dur = 9;
      ch.forEach((f, i) => {
        const g = ac.createGain(); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = i ? 1100 : 400;
        lp.connect(g); g.connect(bgmBus); g.connect(verb);
        const o1 = osc(i ? 'triangle' : 'sine', f, lp, when, dur + 3), o2 = osc('sine', f * 1.003, lp, when, dur + 3);
        o1.detune.value = -4; o2.detune.value = 5;
        const pk = i ? .035 : .06;
        g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(pk, when + 3); g.gain.setValueAtTime(pk, when + dur - 1); g.gain.exponentialRampToValueAtTime(.0001, when + dur + 3);
      });
      // 这 9 秒里撒 2~4 个钢琴音
      const n = 2 + (Math.random() * 3 | 0);
      for (let k = 0; k < n; k++) {
        const w = when + 1 + Math.random() * (dur - 2), f = S.SCALE[Math.random() * S.SCALE.length | 0];
        const g = ac.createGain(); g.connect(bgmBus); g.connect(verb);
        osc('sine', f, g, w, 4); const h = osc('sine', f * 2, g, w, 1.2); h.detune.value = 3;
        env(g, w, .006, .05 + Math.random() * .03, 3.4);
      }
      // 偶尔一声胶片噼啪
      if (Math.random() < .6) { const w = when + Math.random() * dur; const cg = ac.createGain(); const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; noise(hp, .02, w); hp.connect(cg); cg.connect(bgmBus); env(cg, w, .001, .08, .015); }
      S.bgmNext += dur;
    }
  },
};
// 自检用：丢掉当前音频上下文（配合 OfflineAudioContext 离线渲染测电平）
S._reset = () => { clearInterval(S.bgmTimer); ac = null; S.projector = S.drone = S.room = null; S.bgmOn = false; S.unlocked = false; };
window.FySound = S;
})();
