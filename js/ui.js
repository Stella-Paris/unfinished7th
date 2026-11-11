/* 未完的第七日 — 界面控制器。所有游戏规则在 engine.js，这里只负责呈现与输入。 */
(function () {
  "use strict";
  const D = window.GAME_DATA, C = D.config;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SAVE = "u7_save", SET = "u7_settings";
  const STAGE_NAME = { dawn: "清晨", morning: "上午课程", noon: "下午 · 文化祭筹备", dusk: "黄昏 · 自由勘察", event: "夜幕", night: "夜", festival: "文化祭", finale: "终焉" };
  const POS = { left: 27, center: 50, right: 73, farleft: 15, farright: 85 };
  const STAT_CN = { INT: "智力", CON: "体质", POW: "超能力", SAN: "理智" };

  const settings = Object.assign({ bgm: 60, sfx: 70, voice: 85, voiceOn: false, textSpeed: 55, autoDelay: 40 }, JSON.parse(localStorage.getItem(SET) || "{}"));
  Object.assign(Audio7.settings, settings);

  let G = new Engine.Game(D);
  const saved = localStorage.getItem(SAVE);
  if (saved) try { G.load(saved); } catch (e) { console.warn("save corrupt", e); }

  const ui = { mode: null, typing: false, auto: false, skip: false, log: [], pres: null, runStartInsight: 0, lastStats: null, waiting: null };

  /* ---------------- 舞台缩放 ---------------- */
  function fit() {
    const s = Math.min(innerWidth / 1600, innerHeight / 900);
    const st = $("#stage");
    st.style.transform = `scale(${s})`; st.style.left = `${(innerWidth - 1600 * s) / 2}px`; st.style.top = `${(innerHeight - 900 * s) / 2}px`;
  }
  addEventListener("resize", fit); fit();

  /* ---------------- 工具 ---------------- */
  function show(id) { $$(".screen").forEach((e) => e.classList.toggle("hidden", e.id !== id)); ui.screen = id; }
  function save() { if (G.run) G.run.pres = ui.pres; localStorage.setItem(SAVE, G.save()); }
  function toast(msg, cls = "") { const t = document.createElement("div"); t.className = "toast " + cls; t.innerHTML = msg; const box = $("#toasts"); box.appendChild(t); while (box.children.length > 6) box.firstChild.remove(); setTimeout(() => t.remove(), 3700); }
  function charOf(id) { return C.characters.chars[id] || { name: id }; }
  function spriteUrl(id) { const c = charOf(id); return c.sprite ? `assets/${c.sprite}` : null; }
  function itemIcon(id) { return `assets/ui/items/${id}.webp`; }
  function fxText(fx) {
    return Object.entries(fx || {}).filter(([k, v]) => STAT_CN[k] && v).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(" · ");
  }
  function sfx(id) { Audio7.sfx(id); }

  G.listeners.push((ev) => {
    if (ev.type === "insight") { toast(`✦ 观测深度 Insight +${ev.n}　<small>(${ev.total}/100)</small>`); sfx("insight"); }
    if (ev.type === "insight_tier") {
      const t = { 30: "【直觉警示】已觉醒：危机来临前将提示属性短板，判定数值可见。", 60: "【因果转译】已觉醒：可将干涉道具跨周目交给未操控的少女。", 100: "观测深度已满。通往「第八日」的门槛，已经达成。" }[ev.at];
      setTimeout(() => toast(t, "gold"), 600);
    }
    if (ev.type === "relic") { toast(`◆ 获得灵魂信物【${C.items.items[ev.id].name}】`, "gold"); sfx("success"); }
    if (ev.type === "train") {
      const why = ev.outcome === "resolved" ? "异常已平息，消耗降低" : ev.outcome === "failed" ? "异常未能平息，消耗增加" : ev.outcome === "avoided" ? "绕开了异常，消耗增加" : ev.kind === "encounter" ? `有${charOf(ev.girl).name}陪着，消耗减半` : "";
      const bad = ev.outcome === "failed" || ev.outcome === "avoided";
      toast(`特训 · ${ev.name}：${fxText(ev.fx)}${why ? `<br><small>${why}</small>` : ""}`, bad ? "red" : ev.kind === "encounter" || ev.outcome === "resolved" ? "gold" : "");
    }
    if (ev.type === "skill") { toast(`♪ 羁绊技能解锁【${ev.name}】`, "gold"); sfx("confirm"); }
    if (ev.type === "bond" && G.run) {
      const c = charOf(ev.g);
      if (ev.up) { toast(`♥ 与${c.name}的羁绊 → <b>${C.balance.bond.names[ev.lv]}</b>${ev.lv >= 2 ? "<br><small>黄昏时可以赴约了</small>" : ""}`, "gold"); sfx("success"); }
      else if (ui.screen === "scr-game") toast(`<small>♥ ${c.name} 羁绊 +${ev.n}</small>`, "pink");
    }
    if (ev.type === "rank") toast(`<small>▲ ${STAT_CN[ev.stat]} 晋升至</small> <b>${ev.rank}</b> <small>级</small>`);
    if (ev.type === "awaken") { setTimeout(() => toast(`✦ 异能${ev.lv === 2 ? "二阶" : ""}觉醒【${ev.name}】${ev.lv === 2 ? "<br><small>Day5 起本人危机判定 +" + C.balance.growth.check_bonus + "</small>" : ""}`, "gold"), 300); sfx("insight"); }
  });

  /* ---------------- 标题 ---------------- */
  function enterTitle() {
    show("scr-title");
    $("#btn-continue").disabled = !G.run;
    Audio7.bgm("title");
  }
  $("#tap-start").addEventListener("click", () => { $("#tap-start").remove(); Audio7.unlock(); Audio7.bgm("title"); sfx("confirm"); });
  $(".title-menu").addEventListener("click", (e) => {
    const a = e.target.dataset.act; if (!a) return; sfx("click");
    if (a === "new") enterHub();
    if (a === "continue" && G.run) resumeRun();
    if (a === "settings") openOverlay("settings");
    if (a === "gallery") openGallery();
  });

  /* ---------------- 观测空间 ---------------- */
  function echoHearts(g) {   // 灵魂残响：历史最高羁绊（下周目会继承一部分）
    const BB = C.balance.bond, p = (G.meta.bondMax || {})[g] || 0;
    if (!p) return "";
    const lv = BB.levels.filter((t) => p >= t).length;
    return `<div class="echo" title="灵魂残响：历史最高羁绊「${BB.names[lv]}」。投影其他少女时，她会隐约记得你（初始羁绊 +${Math.floor(p * BB.memory_ratio)}）">${"♥".repeat(lv)}${"♡".repeat(3 - lv)}</div>`;
  }
  function bondPips(g) {
    const b = G.bondInfo(g), BB = C.balance.bond;
    const frac = b.next ? (b.pts - b.prev) / (b.next - b.prev) : 1;
    return `<span class="pips">${[1, 2, 3].map((i) => `<i class="${b.lv >= i ? "on" : b.lv + 1 === i ? "part" : ""}" style="${b.lv + 1 === i ? `--f:${Math.round(frac * 100)}%` : ""}"></i>`).join("")}</span>`;
  }
  function enterHub() {
    show("scr-hub"); Audio7.bgm("void");
    if (G.run) { // 存在未完成的周目
      if (confirm("存在未完成的周目。继续该周目吗？\n（取消将放弃该周目，回到观测空间）")) return resumeRun();
      G.endRun(); save();
    }
    const ins = G.insight, B = C.balance;
    $("#hub-ins .val").style.strokeDashoffset = 327 * (1 - ins / 100);
    $("#hub-ins b").textContent = ins;
    $("#hub-tiers").innerHTML = [[B.insight.intuition_at, "直觉警示"], [B.insight.transfer_at, "因果转译"], [B.insight.true_end_at, "真相之门"]]
      .map(([t, n]) => `<div class="${ins >= t ? "on" : ""}">${t} · ${n}</div>`).join("");
    const cards = C.characters.playable.map((g) => {
      const c = charOf(g), cleared = G.meta.cleared[g], relic = G.meta.relics.includes(c.relic);
      return `<div class="gcard" data-g="${g}" style="--c:${c.color}">
        <div class="pic" style="background-image:url(assets/${c.sprite})"></div>
        ${relic ? `<div class="relic-ic" style="background-image:url(${itemIcon(c.relic)})"></div>` : ""}
        ${cleared ? `<div class="badge">已救赎 ×${cleared}</div>` : ""}
        ${echoHearts(g)}
        <div class="info"><b>${c.full}</b><small>${c.grade} · ${c.ability}</small><p>${c.tag}</p></div></div>`;
    });
    const un = G.loop7Unlocked(), h = charOf("hero");
    cards.push(`<div class="gcard final ${un ? "" : "locked"}" data-g="hero">
      <div class="pic" style="background-image:url(assets/${h.sprite})"></div>
      <div class="badge">${un ? "终章" : `完成 ${G.meta.runsCompleted}/${C.balance.loop7_unlock_runs} 个周目后开启`}</div>
      <div class="info"><b>第七周目 · 本尊降临</b><small>${h.ability}</small><p>带着六人的羁绊，以自己的样子回到学园。</p></div></div>`);
    $("#hub-cards").innerHTML = cards.join("");
    const slot = (id, on) => { const it = C.items.items[id]; return `<div class="slot ${on ? "on" : ""}" style="${on ? `background-image:url(${itemIcon(id)})` : ""}"><div class="tip"><b>${on ? it.name : "？？？"}</b>${on ? it.desc : "尚未获得"}</div></div>`; };
    const ids = (t) => Object.keys(C.items.items).filter((k) => C.items.items[k].type === t);
    $("#hub-relics").innerHTML = ids("relic").map((k) => slot(k, G.meta.relics.includes(k))).join("");
    $("#hub-aids").innerHTML = ids("aid").map((k) => slot(k, G.meta.aids.includes(k))).join("");
    $("#hub-keys").innerHTML = ids("key").map((k) => slot(k, G.meta.keys.includes(k))).join("");
    $("#hub-endings").innerHTML = Object.entries(C.world.endings).map(([k, e]) => `<div class="${G.meta.endings[k] ? "on" : ""}"><span>${G.meta.endings[k] ? e.name : "？？？？"}</span><i class="${e.type}">${e.type}</i></div>`).join("");
    $("#hub-loop").textContent = `已观测 ${G.meta.loops} 次轮回 · 完成 ${G.meta.runsCompleted} 个周目 · 因果断裂 ${G.meta.deaths} 次`;
  }
  $("#hub-cards").addEventListener("click", (e) => {
    const card = e.target.closest(".gcard"); if (!card || card.classList.contains("locked")) return;
    sfx("confirm"); startRun(card.dataset.g);
  });
  $(".hub-foot [data-act=title]").addEventListener("click", () => { sfx("click"); enterTitle(); });

  /* ---------------- 周目 ---------------- */
  function startRun(route) {
    G.startRun(route);
    ui.pres = { bg: null, bgm: null, cg: null, sprites: {} };
    ui.log = []; ui.runStartInsight = G.insight; ui.runStartRelics = G.meta.relics.length; ui.lastStats = null;
    enterGame();
  }
  function resumeRun() {
    ui.pres = G.run.pres || { bg: null, bgm: null, cg: null, sprites: {} };
    ui.runStartInsight = ui.runStartInsight || G.insight; ui.runStartRelics = ui.runStartRelics ?? G.meta.relics.length;
    enterGame(true);
  }
  function enterGame(resume) {
    show("scr-game");
    $("#sprites").innerHTML = ""; $$(".bg").forEach((b) => b.classList.remove("on"));
    const p = ui.pres; ui.pres = { bg: null, bgm: null, cg: null, sprites: {} };
    if (p.bg) setBg(p.bg, true);
    if (p.bgm) setBgm(p.bgm);
    if (p.cg) setCg(p.cg);
    for (const [id, pos] of Object.entries(p.sprites || {})) showSprite(id, pos);
    const c = charOf(G.run.route);
    const hs = $("#hud-stats"); hs.style.setProperty("--c", c.color);
    $("#hud-face").style.backgroundImage = `url(assets/${c.sprite})`;
    $("#hud-name").textContent = c.full; $("#hud-ability").textContent = c.ability;
    hideAllPanels(); updateHud();
    if (resume && p.lastLine) { renderLine(p.lastLine, true); return; }
    pump();
  }

  /* ---------------- 主循环 ---------------- */
  function pump() {
    for (let guard = 0; guard < 500; guard++) {
      const v = G.next();
      if (v.type === "cmd") { runCmd(v.cmd); continue; }
      updateHud();
      if (v.type === "line") { save(); return renderLine(v); }
      ui.pres.lastLine = null;
      hideDialog();
      if (v.type === "choice") { save(); return renderChoice(v); }
      if (v.type === "check") { save(); return renderCheck(v); }
      if (v.type === "phase") { save(); return renderPhase(v); }
      if (v.type === "summary") { save(); return renderSummary(v); }
      if (v.type === "ending") return renderEnding(v);
      if (v.type === "hub") return enterHub();
    }
  }

  /* ---------------- 演出指令 ---------------- */
  function setBg(id, instant) {
    if (!id || ui.pres.bg === id) return; ui.pres.bg = id;
    const a = $("#bg-a"), b = $("#bg-b"), on = a.classList.contains("on") ? a : b, off = on === a ? b : a;
    off.style.backgroundImage = `url(assets/bg/${id}.webp)`;
    if (instant) off.style.transition = "none";
    off.classList.add("on"); on.classList.remove("on");
    if (instant) requestAnimationFrame(() => (off.style.transition = ""));
  }
  function setBgm(id) { ui.pres.bgm = id === "stop" ? null : id; Audio7.bgm(id); }
  function setCg(id) {
    const el = $("#cg");
    if (!id || id === "off") { el.classList.remove("on"); ui.pres.cg = null; return; }
    el.style.backgroundImage = `url(assets/cg/${id}.webp)`; el.classList.add("on"); ui.pres.cg = id;
  }
  function showSprite(id, pos = "center") {
    const url = spriteUrl(id); if (!url) return;
    let el = $(`#sprites [data-id="${id}"]`);
    if (!el) { el = document.createElement("img"); el.className = "sprite"; el.dataset.id = id; el.src = url; $("#sprites").appendChild(el); requestAnimationFrame(() => el.classList.add("on")); }
    el.style.left = (POS[pos] || 50) + "%";
    ui.pres.sprites[id] = pos;
  }
  function hideSprite(id) {
    const els = id === "all" ? $$("#sprites .sprite") : $$(`#sprites [data-id="${id}"]`);
    els.forEach((e) => { e.classList.remove("on"); setTimeout(() => e.remove(), 500); delete ui.pres.sprites[e.dataset.id]; });
  }
  function fx(kind) {
    const g = $("#scr-game");
    if (kind === "shake") { g.classList.remove("shake"); void g.offsetWidth; g.classList.add("shake"); }
    if (kind === "flash" || kind === "redflash" || kind === "whiteout") {
      const f = $("#fx-flash"); f.className = "fx-flash"; void f.offsetWidth;
      f.classList.add(kind === "whiteout" ? "white" : "go"); if (kind === "redflash") f.classList.add("red");
      if (kind === "whiteout") sfx("whiteout");
    }
    if (kind === "glitch") { const f = $("#fx-glitch"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go"); }
  }
  function runCmd(c) {
    if (ui.skip && c.t === "fx") return;
    switch (c.t) {
      case "bg": setBg(c.a); break;
      case "bgm": setBgm(c.a); break;
      case "sfx": if (!ui.skip) sfx(c.a); break;
      case "show": showSprite(c.a, c.b || "center"); break;
      case "hide": hideSprite(c.a); break;
      case "cg": setCg(c.a); break;
      case "fx": fx(c.a); break;
    }
  }

  /* ---------------- 对话 ---------------- */
  let typeTimer = null, autoTimer = null;
  function renderLine(v, resumed) {
    hidePhase();
    ui.pres.lastLine = v;
    const dlg = $("#dialog"), txt = $("#dlg-text"), np = $("#dlg-name");
    dlg.classList.remove("hidden");
    const c = v.who ? charOf(v.who) : null;
    np.textContent = v.inner ? "" : c ? c.name : "";
    np.style.setProperty("--c", c && c.color ? c.color : "#7c1022");
    txt.className = "dlg-text " + (v.inner ? "inner" : v.who ? "" : "narr");
    for (const s of $$("#sprites .sprite")) s.classList.toggle("dim", !!v.who && !v.inner && s.dataset.id !== v.who && !!$(`#sprites [data-id="${v.who}"]`));
    const full = v.who && !v.inner ? `「${v.text}」` : v.text;
    if (!resumed) ui.log.push({ name: v.inner ? "" : c ? c.name : "", text: v.text, inner: v.inner });
    if (ui.log.length > 300) ui.log.shift();
    clearTimeout(typeTimer); clearTimeout(autoTimer);
    const fast = ui.skip || (ui.auto && v.read);   // AUTO 模式下，已读过的句子自动快进
    const voiceP = !fast && v.voice ? Audio7.voice(v.voice) : (Audio7.stopVoice(), Promise.resolve(false));
    ui.waiting = "line";
    if (fast) { txt.textContent = full; ui.typing = false; dlg.classList.remove("typing"); autoTimer = setTimeout(advanceLine, ui.skip ? 40 : 90); return; }
    let i = 0; ui.typing = true; dlg.classList.add("typing"); txt.textContent = "";
    const cps = 12 + settings.textSpeed * 0.9;
    (function tick() {
      i++; txt.textContent = full.slice(0, i);
      if (i < full.length && ui.typing) typeTimer = setTimeout(tick, 1000 / cps);
      else { txt.textContent = full; ui.typing = false; dlg.classList.remove("typing"); scheduleAuto(voiceP, full.length); }
    })();
  }
  function scheduleAuto(voiceP, len) {
    if (!ui.auto) return;
    voiceP.then(() => { if (ui.auto && ui.waiting === "line") autoTimer = setTimeout(advanceLine, 400 + (101 - settings.autoDelay) * 0 + settings.autoDelay * 25 + len * 30); });
  }
  function advanceLine() {
    if (ui.waiting !== "line") return;
    if (ui.typing) { ui.typing = false; return; }
    ui.waiting = null; clearTimeout(autoTimer);
    pump();
  }
  function hideDialog() { $("#dialog").classList.add("hidden"); }
  $("#dialog").addEventListener("click", () => advanceLine());

  /* ---------------- 选项 ---------------- */
  function garble(t) {
    const glyph = "▓▒░#%&@$◆※¤";
    return [...t].map((ch) => (Math.random() < C.balance.san.garble_ratio ? `<span class="g">${glyph[Math.floor(Math.random() * glyph.length)]}</span>` : ch)).join("");
  }
  function renderChoice(v) {
    ui.skip = false; $("#btn-skip").classList.remove("on");
    const box = $("#choices"); box.classList.remove("hidden");
    box.classList.toggle("disturbed", v.san !== "stable");
    box.innerHTML = v.opts.map((o, i) => `<button data-i="${i}">${v.san !== "stable" ? garble(o.text) : o.text}</button>`).join("");
    ui.waiting = "choice";
  }
  $("#choices").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || ui.waiting !== "choice") return;
    sfx("confirm"); ui.waiting = null;
    const r = G.choose(+b.dataset.i);
    $("#choices").classList.add("hidden");
    if (r.slipped) { toast("……手指不听使唤。你选中了另一个选项。", "red"); sfx("glitch"); fx("glitch"); }
    pump();
  });

  /* ---------------- 判定 ---------------- */
  function checkTitle(id) {
    if (id === "final") return "终局 · 破局判定";
    if (id === "anomaly") return "异常处理";
    const d = +id.split("_d")[1];
    return ({ 1: "理智检定", 2: "初级危机检定", 3: "中级危机检定", 4: "高阶危机检定", 5: "生死判定", 6: "真相推演" })[d] || "危机判定";
  }
  function renderCheck(v) {
    ui.skip = false; $("#btn-skip").classList.remove("on");
    const m = $("#check"); m.classList.remove("hidden");
    $("#chk-stamp").className = "chk-stamp"; $("#chk-stamp").textContent = "";
    $("#chk-kind").textContent = v.fatal ? "⚠ 生死判定 · 失败即因果断裂" : v.id === "final" ? "第七日 17:50" : v.id === "anomaly" ? `DAY ${G.run.day} · 黄昏异常（失败不致命）` : `DAY ${G.run.day} · 危机判定`;
    $("#chk-title").textContent = checkTitle(v.id);
    $("#chk-mode").textContent = v.mode === "any" ? "满足以下任意一项即可" : "需要同时满足以下全部条件";
    $("#chk-rows").innerHTML = v.rows.map((r) => {
      const ok = r.have >= r.need, rev = v.reveal || v.id === "final";
      return `<div class="chk-row ${rev ? (ok ? "ok" : "ng") : ""}"><label>${r.stat} ${STAT_CN[r.stat]}</label>
        <div class="bar"><i style="width:${Math.min(100, r.have)}%"></i><s class="${rev ? "" : "hidden-need"}" style="left:${rev ? Math.min(99, r.need) : 50}%"></s></div>
        <span>${r.have} / ${rev ? r.need : "？？"}</span></div>`;
    }).join("");
    const B = C.balance.burn_san;
    const notes = [];
    if (v.bonus) {
      const parts = [];
      if (v.stanceBonus) parts.push(`抉择 ${v.stanceBonus > 0 ? "+" : ""}${v.stanceBonus}`);
      if (v.support && v.support.n) parts.push(`同伴支援 +${v.support.n}（${v.support.girls.map((g) => charOf(g).name).join("、")}）`);
      if (v.awaken) parts.push(`异能觉醒 +${v.awaken}`);
      notes.push(`修正合计：<b>${v.bonus > 0 ? "+" : ""}${v.bonus}</b>（已计入）${parts.length ? "<br><small>" + parts.join("　·　") + "</small>" : ""}`);
    }
    if (!v.reveal && v.id !== "final") notes.push("观测深度不足 30，无法看清危机的全貌……");
    if (v.reveal && !v.pass) notes.push("<b>直觉在尖叫：现在的你，跨不过去。</b>");
    if (v.id === "final") notes.push(`仍在你身后的同伴：<b>${v.rows.length ? G.checkSpec("final").allies : 0}</b> 人（每人降低需求 ${C.balance.final_check.ally_reduction}）`);
    $("#chk-note").innerHTML = notes.join("<br>");
    const burn = $("#chk-burn");
    burn.textContent = `燃烧理智（SAN −${B.cost}，属性 +${B.bonus}）`;
    burn.disabled = !v.burnable;
    ui.waiting = "check";
    sfx("heartbeat");
  }
  function doCheck(burn) {
    if (ui.waiting !== "check") return; ui.waiting = null;
    const r = G.resolveCheck(burn);
    const st = $("#chk-stamp"); st.textContent = r.ok ? "突破" : "失败"; st.className = "chk-stamp " + (r.ok ? "ok" : "ng");
    sfx(r.ok ? "success" : "fail"); if (!r.ok) fx("redflash");
    updateHud();
    setTimeout(() => { $("#check").classList.add("hidden"); pump(); }, 1500);
  }
  $("#chk-go").addEventListener("click", () => doCheck(false));
  $("#chk-burn").addEventListener("click", () => doCheck(true));

  /* ---------------- 行动阶段 ---------------- */
  const PHASE_BG = { morning: "classroom_day", noon: "classroom_day", dusk: "classroom_dusk" };
  function renderPhase(v) {
    ui.skip = false; $("#btn-skip").classList.remove("on");
    hideSprite("all"); setCg("off");
    setBg(PHASE_BG[v.stage]);
    setBgm(v.stage === "dusk" ? (v.day >= 4 ? "mystery" : "calm") : v.day >= 5 ? "tension" : "daily");
    const p = $("#phase"); p.classList.remove("hidden");
    $("#phase-title").textContent = STAGE_NAME[v.stage];
    $("#phase-ap").innerHTML = Array.from({ length: C.balance.ap_per_phase }, (_, i) => `<i class="${i < v.ap ? "on" : ""}"></i>`).join("");
    const intu = G.intuition();
    const ib = $("#intuition");
    if (intu && intu.length && v.stage === "morning") {
      ib.classList.remove("hidden");
      ib.innerHTML = "<b>直觉警示</b>" + intu.map((x) => `Day ${x.day}${x.fatal ? "（生死）" : ""} 需要 ${x.stat} ${x.need}，当前 ${x.have}`).join("　｜　");
    } else ib.classList.add("hidden");
    const cards = v.options.map((o, i) => {
      if (o.kind === "class") return `<button class="pcard" data-i="${i}"><span class="ic">${o.icon}</span><b>${o.name}</b><p>${o.desc}</p><span class="fxs">${o.stat} ↑${C.balance.class_san_cost[o.stat] ? ` · SAN −${C.balance.class_san_cost[o.stat]}` : ""}</span></button>`;
      if (o.kind === "activity") return `<button class="pcard ${o.done ? "done" : ""} ${o.closed ? "closed" : ""}" data-i="${i}"><span class="ic">${o.icon}</span><b>${o.name}</b>
        <p>${o.closed ? "负责人已不在了……项目关闭。" : o.done ? "今天已经排练过了。" : `羁绊技能【${o.skill}】`}</p>
        <span class="fxs">${fxText(o.fx)}${o.owner && o.owner !== G.run.route && !o.closed ? ` · ♥${charOf(o.owner).name}` : ""}</span><div class="prog"><i style="width:${Math.min(100, (o.count / o.need) * 100)}%"></i></div>
        <p>排练 ${Math.min(o.count, o.need)}/${o.need}${o.count >= o.need ? " ✓ 已解锁" : ""}</p></button>`;
      if (o.kind === "explore") {
        if (o.rest) return `<button class="pcard rest" data-i="${i}"><span class="ic">${o.icon}</span><b>${o.name}</b><p>什么都不做，好好睡一觉。</p><span class="fxs">SAN +${C.balance.rest_san}</span></button>`;
        const p = o.preview;
        const train = p.stats.map((k) => `${k} ↑`).join(" ") + (p.san > 0 ? ` · SAN −${p.san}` : p.san < 0 ? ` · SAN +${-p.san}` : "");
        const regs = (p.regulars || []).map((g) => `<i style="background-image:url(assets/${charOf(g).sprite})" title="${charOf(g).name}常来这里"></i>`).join("");
        const area = p.nextArea ? `<em class="new-area">新区域：${p.nextArea}</em>` : `已探明 ${p.unlocked}/${p.areas} 区`;
        const hint = o.clue ? (o.newInsight ? "这里有尚未观测到的东西……" : "这里似乎有什么，但你已经见过了。") : p.resolved ? "异常已平息，特训时心更静了。" : p.san < 0 ? "适合疗养的地方。" : "特训 · 可能遭遇异常，或偶遇谁。";
        return `<button class="pcard" data-i="${i}">${o.clue ? `<span class="mark ${o.newInsight ? "new" : ""}">!</span>` : ""}<span class="ic">${o.icon}</span><b>${o.name}</b>
          <p class="area">${area}</p><p>${hint}</p>${regs ? `<div class="regs">${regs}</div>` : ""}<span class="fxs ${p.resolved ? "calm" : ""}">${train}</span></button>`;
      }
      if (o.kind === "bond") return `<button class="pcard bond" data-i="${i}"><span class="ic face" style="background-image:url(assets/${charOf(o.owner).sprite})"></span><b>${o.name}</b><p>羁绊「${C.balance.bond.names[o.lv]}」· ${o.lv === 3 ? "她似乎有很重要的话想对你说。" : "她在等你。"}</p><span class="fxs">SAN +${C.balance.bond.event_san} · ${o.sig} +${C.balance.bond.event_stat}</span></button>`;
      if (o.kind === "deliver") return `<button class="pcard deliver" data-i="${i}"><span class="ic">✧</span><b>${o.name}</b><p>前往【${C.explore.locations[o.loc].name}】交给 ${charOf(o.owner).full}。期限：Day ${o.deadline} 黄昏。</p></button>`;
    });
    const pc = $("#phase-cards"); pc.className = "phase-cards" + (v.options.length > 6 ? " many" : "");
    pc.innerHTML = cards.join("");
    ui.phaseView = v; ui.waiting = "phase";
  }
  $("#phase-cards").addEventListener("click", (e) => {
    const b = e.target.closest(".pcard"); if (!b || ui.waiting !== "phase") return;
    const o = ui.phaseView.options[+b.dataset.i]; ui.waiting = null; sfx("confirm");
    const res = G.act(o.kind, o.id);
    if (res.bg) { hideSprite("all"); setBg(res.bg); toast(`${C.explore.locations[o.id].name} · ${res.area}${res.newArea ? "　<small>（新区域）</small>" : ""}`); }
    const t = fxText(res.fx); if (t) toast(t, Object.values(res.fx).some((x) => x < 0) && !Object.values(res.fx).some((x) => x > 0) ? "red" : "");
    if (res.key) toast(`◆ 获得核心解密道具【${C.items.items[res.key].name}】`, "gold");
    hidePhase(); pump();
  });
  function hidePhase() { $("#phase").classList.add("hidden"); }
  function hideAllPanels() { ["#phase", "#dialog", "#choices", "#check", "#summary"].forEach((s) => $(s).classList.add("hidden")); }

  /* ---------------- 夜间总结 ---------------- */
  function renderSummary(v) {
    hideSprite("all"); setCg("off"); setBg("rooftop_night"); setBgm("calm");
    $("#summary").classList.remove("hidden");
    $("#sum-title").textContent = `Day ${v.day} 结束`;
    const agg = {};
    for (const x of v.log) agg[x.stat] = (agg[x.stat] || 0) + x.d;
    for (const k in agg) if (!agg[k]) delete agg[k];
    let h = "<h4>今日成长</h4>" + (Object.keys(agg).length ? Object.entries(agg).map(([k, d]) => `<span class="chg ${d > 0 ? "up" : "dn"}">${k} ${d > 0 ? "+" : ""}${d}</span>`).join("") : "<p>平静的一天。</p>");
    const db = G.run.dayBond || {};
    if (Object.keys(db).length) h += "<h4>今日羁绊</h4>" + Object.entries(db).map(([g, n]) => `<span class="chg bond">${charOf(g).name} ♥+${n} · ${G.bondInfo(g).name}</span>`).join("");
    if (v.news.length) h += "<h4>校园传闻</h4>" + v.news.map((n) => `<p>${n}</p>`).join("");
    if (G.run.injury) h += `<h4>负伤</h4><p>身体还没恢复，明天上午的行动力 −${C.balance.injury.ap_penalty}。</p>`;
    h += `<h4>明日</h4><p>清晨将恢复 SAN +${C.balance.san.daily_regen}；${v.day < 7 ? `Day ${v.day + 1}【${C.world.macro[v.day + 1].title}】` : ""}</p>`;
    $("#sum-body").innerHTML = h;
    ui.waiting = "summary";
  }
  $("#sum-ok").addEventListener("click", () => { if (ui.waiting !== "summary") return; ui.waiting = null; sfx("bell"); $("#summary").classList.add("hidden"); pump(); });

  /* ---------------- 结局 ---------------- */
  function renderEnding(v) {
    hideAllPanels(); Audio7.stopVoice();
    const r = G.run, info = C.world.endings[v.id];
    const bg = { be_death: "bg/white_out", be_collapse: "bg/obs_space", be_white: "cg/cg_be_white", route_clear: `cg/cg_${r.route}_d7`, ne: "cg/cg_ne_ruins", te: "cg/cg_te_day8" }[v.id] || "bg/obs_space";
    show("scr-ending");
    $("#end-bg").style.backgroundImage = `url(assets/${bg}.webp)`;
    $("#end-type").textContent = { BE: "BAD END", NE: "NORMAL END", TE: "TRUE END", CLEAR: "ROUTE CLEAR" }[info.type];
    $("#end-name").textContent = info.name; $("#end-desc").textContent = info.desc;
    const gains = [];
    const di = G.insight - ui.runStartInsight; if (di > 0) gains.push(`观测深度 +${di}（当前 ${G.insight}/100）`);
    if (G.meta.relics.length > ui.runStartRelics) gains.push(`灵魂信物：${C.items.items[G.meta.relics[G.meta.relics.length - 1]].name}`);
    if (v.id === "route_clear") { const aid = charOf(r.route).aid; gains.push(`解锁因果干涉道具：${C.items.items[aid].name}`); }
    if (v.id.startsWith("be")) gains.push("因果回溯——但你记住的一切都不会消失。");
    $("#end-gain").innerHTML = gains.join("<br>");
    Audio7.bgm(v.id === "te" || v.id === "route_clear" ? "hope" : v.id === "ne" ? "sad" : "void");
    G.endRun(); save();
  }
  $("#end-ok").addEventListener("click", () => { sfx("click"); enterHub(); });

  /* ---------------- HUD ---------------- */
  function updateHud() {
    const r = G.run; if (!r) return;
    $("#hud-day").textContent = `DAY ${r.day}`;
    $("#hud-theme").textContent = `【${C.world.macro[r.day].title}】`;
    const order = ["dawn", "morning", "noon", "dusk", "event"];
    const si = order.indexOf(r.stage === "night" ? "event" : r.stage);
    $$("#hud-time li").forEach((li, i) => { li.className = i === si ? "on" : i < si ? "done" : ""; });
    for (const k of ["INT", "CON", "POW", "SAN"]) {
      const el = $(`.stat[data-k=${k}]`), v = r.stats[k];
      el.querySelector("b").textContent = v; el.querySelector("i").style.width = Math.min(100, v) + "%";
      if (k !== "SAN") { let rk = el.querySelector(".rk"); if (!rk) { rk = document.createElement("em"); rk.className = "rk"; el.querySelector("label").appendChild(rk); } const R = G.rank(v); rk.textContent = R; rk.dataset.r = R; }
      if (ui.lastStats && ui.lastStats[k] !== v) { el.classList.remove("bump", "drop"); void el.offsetWidth; el.classList.add(v > ui.lastStats[k] ? "bump" : "drop"); }
    }
    ui.lastStats = { ...r.stats };
    const st = G.sanState(), san = $(".stat.san");
    san.classList.toggle("disturbed", st === "disturbed"); san.classList.toggle("collapse", st === "collapse");
    $("#hud-san-state").textContent = { stable: "稳定", disturbed: "紊乱", collapse: "崩溃" }[st];
    $("#fx-red").classList.toggle("on", st !== "stable");
    $("#scr-game").classList.toggle("glitchy", st !== "stable");
    $("#hud-ins").textContent = G.insight;
    const B = C.balance.insight;
    $("#hud-ins-tier").textContent = G.insight >= B.true_end_at ? "真相之门" : G.insight >= B.transfer_at ? "因果转译" : G.insight >= B.intuition_at ? "直觉警示" : "";
    $("#hud-npc").innerHTML = Object.entries(r.npc).map(([g, n]) => { const b = G.bondInfo(g); return `<div class="npc ${n.alive ? "" : "dead"} ${n.aided ? "aided" : ""}" title="${charOf(g).full}${n.alive ? ` · 羁绊「${b.name}」${b.next ? `（${b.pts}/${b.next}）` : ""}` : "（已故）"}${n.aided ? " · 已交付干涉道具" : ""}"><div class="face" style="background-image:url(assets/${charOf(g).sprite})"></div>${n.alive ? bondPips(g) : ""}</div>`; }).join("");
  }

  /* ---------------- 浮层 / 菜单 ---------------- */
  function openOverlay(id) {
    $("#" + id).classList.remove("hidden");
    if (id === "settings") $$("[data-set]").forEach((i) => { if (i.type === "checkbox") i.checked = !!settings[i.dataset.set]; else i.value = settings[i.dataset.set]; });
  }
  $$(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o || e.target.hasAttribute("data-close")) { sfx("click"); o.classList.add("hidden"); } }));
  function saveSettings() { Object.assign(Audio7.settings, settings); Audio7.apply(); localStorage.setItem(SET, JSON.stringify(settings)); syncVoiceBtn(); }
  function syncVoiceBtn() { const b = $("#btn-voice"); if (b) b.classList.toggle("on", !!settings.voiceOn); if (!settings.voiceOn) Audio7.stopVoice(); }
  $$("[data-set]").forEach((i) => i.addEventListener(i.type === "checkbox" ? "change" : "input", () => {
    settings[i.dataset.set] = i.type === "checkbox" ? i.checked : +i.value; saveSettings();
  }));
  $("#btn-reset").addEventListener("click", () => {
    if (!confirm("确定清除全部进度（含 Insight、信物、结局记录）？此操作不可撤销。")) return;
    localStorage.removeItem(SAVE); G = new Engine.Game(D); window.U7.G = G; location.reload();
  });
  function openGallery() {
    const seen = G.meta.cgSeen || {};
    const ids = [...new Set(Object.values(D.scenes).flat().filter((c) => c.t === "cg" && c.a !== "off").map((c) => c.a))];
    $("#gallery-body").innerHTML = ids.map((id) => `<div class="${seen[id] ? "" : "lock"}" style="${seen[id] ? `background-image:url(assets/cg/${id}.webp)` : ""}"><span>${seen[id] ? id.replace("cg_", "") : "？？？"}</span></div>`).join("");
    openOverlay("gallery");
  }
  $(".hud-btns").addEventListener("click", (e) => {
    const a = e.target.dataset.act; if (!a) return; sfx("click");
    if (a === "log") { $("#log-body").innerHTML = ui.log.map((l) => `<p class="${l.inner ? "inner" : ""}">${l.name ? `<b>${l.name}</b>` : ""}${l.text}</p>`).join(""); openOverlay("log"); $("#log-body").scrollTop = 1e9; }
    if (a === "auto") { ui.auto = !ui.auto; e.target.classList.toggle("on", ui.auto); if (ui.auto && ui.waiting === "line" && !ui.typing) advanceLine(); }
    if (a === "skip") { ui.skip = !ui.skip; e.target.classList.toggle("on", ui.skip); if (ui.skip && ui.waiting === "line") advanceLine(); }
    if (a === "settings") openOverlay("settings");
    if (a === "voice") { settings.voiceOn = !settings.voiceOn; saveSettings(); toast(settings.voiceOn ? "角色语音：开" : "角色语音：关"); }
    if (a === "hub") { if (confirm("放弃当前周目，回到观测空间？（已获得的 Insight 与信物会保留）")) { Audio7.stopVoice(); G.endRun(); save(); enterHub(); } }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "F9" || e.key === "`") { window.U7.toggleDebug(); e.preventDefault(); return; }
    if (ui.screen !== "scr-game") return;
    if ((e.key === " " || e.key === "Enter") && ui.waiting === "line") { e.preventDefault(); advanceLine(); }
    if (e.key === "Control" && !ui.skip && ui.waiting === "line") { ui.skip = true; advanceLine(); }
  });
  addEventListener("keyup", (e) => { if (e.key === "Control") ui.skip = $("#btn-skip").classList.contains("on"); });

  /* ---------------- 对外（内部测试接口） ---------------- */
  window.U7 = {
    get G() { return G; }, set G(x) { G = x; },
    ui, save, refresh() { updateHud(); if (ui.screen === "scr-hub") enterHub(); if (ui.waiting === "phase") { hidePhase(); pump(); } },
    enterHub, enterTitle, startRun, pump, toast,
    newGame(meta) { G = new Engine.Game(D, { meta }); G.listeners = []; save(); },
    toggleDebug() {},
  };

  syncVoiceBtn();
  enterTitle();
})();
