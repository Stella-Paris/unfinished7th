/* 音频：BGM 交叉淡入淡出 / 音效 / 语音（语音接口：缺失文件时静默，不影响游戏）。 */
(function () {
  "use strict";
  const S = { bgm: 60, sfx: 70, voice: 85, voiceOn: false };
  let cur = null, curId = null, unlocked = false, voiceEl = null;
  // 防重叠：同一音效 COOLDOWN 毫秒内只播一次，重播时先停掉上一次；同时最多 MAX_SFX 个音效
  const COOLDOWN = 120, MAX_SFX = 3;
  const lastPlay = {}, playing = [];

  function fade(el, to, ms, done) {
    const from = el.volume, t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    })(t0);
  }

  const Audio7 = {
    settings: S,
    unlock() { unlocked = true; if (curId && cur && cur.paused) cur.play().catch(() => {}); },
    /** 测试用：当前正在播放的音频数量 */
    stats() { return { sfx: playing.filter((p) => !p.el.paused).length, voice: !!(voiceEl && !voiceEl.paused), bgm: curId }; },
    bgm(id) {
      if (id === curId) return;
      const old = cur; curId = id;
      if (old) fade(old, 0, 900, () => old.pause());
      if (!id || id === "stop") { cur = null; curId = null; return; }
      const el = new Audio(`assets/audio/bgm/${id}.ogg`);
      el.loop = true; el.volume = 0; cur = el;
      const fadeIn = () => { if (cur === el) fade(el, S.bgm / 100, 1400); else el.pause(); }; // 已被新曲替换则直接停掉
      if (unlocked) el.play().then(fadeIn).catch(() => {});
      else el.addEventListener("play", fadeIn, { once: true });
    },
    sfx(id, vol = 1) {
      if (!id || !unlocked || S.sfx <= 0) return;
      const now = performance.now();
      if (now - (lastPlay[id] || 0) < COOLDOWN) return;
      lastPlay[id] = now;
      for (let i = playing.length - 1; i >= 0; i--) if (playing[i].id === id) { playing[i].el.pause(); playing.splice(i, 1); }
      while (playing.length >= MAX_SFX) playing.shift().el.pause();
      const el = new Audio(`assets/audio/sfx/${id}.ogg`);
      el.volume = Math.min(1, (S.sfx / 100) * vol);
      const rec = { id, el }; playing.push(rec);
      el.onended = () => { const k = playing.indexOf(rec); if (k >= 0) playing.splice(k, 1); };
      el.play().catch(() => {});
    },
    /** 语音接口：path 为 gamedata.voice 中的相对路径；返回 Promise（播放结束或失败时 resolve） */
    voice(path) {
      this.stopVoice();
      if (!path || !unlocked || !S.voiceOn || S.voice <= 0) return Promise.resolve(false);
      return new Promise((res) => {
        const el = new Audio(path); voiceEl = el;
        el.volume = S.voice / 100;
        el.onended = () => res(true); el.onerror = () => res(false);
        if (cur) cur.volume = (S.bgm / 100) * 0.55;          // 语音时压低 BGM
        el.addEventListener("ended", () => { if (cur) fade(cur, S.bgm / 100, 400); });
        el.play().catch(() => res(false));
      });
    },
    stopVoice() { if (voiceEl) { voiceEl.pause(); voiceEl = null; if (cur) cur.volume = S.bgm / 100; } },
    apply() { if (cur) cur.volume = S.bgm / 100; },
  };
  window.Audio7 = Audio7;
})();
