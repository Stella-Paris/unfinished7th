/* 内部测试接口：F9 / ` 键 或 URL 加 ?debug=1 打开。
 * 同时在控制台暴露 window.U7.test：可脚本化地改数值、跳日程、跑决策树模拟。 */
(function () {
  "use strict";
  const D = window.GAME_DATA, C = D.config;
  const P = document.getElementById("debug");
  const { Bot, playRun } = window.Bot;
  const G = () => window.U7.G;

  const test = {
    setStat(k, v) { const r = G().run; if (r) { r.stats[k] = v; window.U7.refresh(); } },
    setInsight(n) { const g = G(); delete g.meta.insightFlags.__debug; g.meta.insightFlags.__debug = Math.max(0, n - g.insight); window.U7.save(); window.U7.refresh(); },
    giveAll(type) {
      const m = G().meta;
      for (const [id, it] of Object.entries(C.items.items)) {
        if (type && it.type !== type) continue;
        const arr = it.type === "relic" ? m.relics : it.type === "aid" ? m.aids : m.keys;
        if (!arr.includes(id)) arr.push(id);
      }
      window.U7.save(); window.U7.refresh();
    },
    unlockLoop7() { const m = G().meta; m.runsCompleted = Math.max(m.runsCompleted, C.balance.loop7_unlock_runs); for (const g of C.characters.playable) m.cleared[g] = m.cleared[g] || 1; window.U7.save(); window.U7.refresh(); },
    jump(day, stage = "dawn") {
      const g = G(), r = g.run; if (!r) return;
      r.day = day; r.stage = stage; r.queue = []; r.script = null; r.nightShown = false; r.pendingEnding = null;
      g.enterStage(); window.U7.ui.pres.lastLine = null; window.U7.ui.waiting = null;
      ["#phase", "#dialog", "#choices", "#check", "#summary"].forEach((s) => document.querySelector(s).classList.add("hidden"));
      window.U7.pump();
    },
    playScene(id) { const g = G(); if (!g.run || !D.scenes[id]) return; g.run.script = null; g.startScene(id); window.U7.ui.waiting = null; window.U7.pump(); },
    npc(gid, alive, aided) { const n = G().run && G().run.npc[gid]; if (n) { if (alive != null) n.alive = alive; if (aided != null) n.aided = aided; window.U7.refresh(); } },
    resetMeta() { if (confirm("重置全部进度？")) { localStorage.removeItem("u7_save"); location.reload(); } },
    exportSave() { return G().save(); },
    importSave(s) { G().load(s); window.U7.save(); location.reload(); },
    /** 用决策树玩家在独立的内存副本中模拟（不影响存档）。返回各角色线统计。 */
    simulate(profile = "blind", n = 100) {
      const out = {};
      for (const route of C.characters.playable) {
        let clear = 0, d5 = 0, collapse = 0;
        for (let i = 0; i < n; i++) {
          const g = new Engine.Game(D, { seed: 9001 + i * 7919 });
          const st = { checks: {} };
          const r = playRun(g, new Bot(profile, 17 + i * 31), route, st);
          if (r.id === "route_clear") clear++; if (r.id === "be_collapse") collapse++;
          const c = st.checks[`${route}_d5`]; if (c && c[1]) d5++;
        }
        out[route] = { clear: clear / n, d5: d5 / n, collapse: collapse / n };
      }
      return out;
    },
    /** 让决策树玩家接管当前周目，直到结局（会推进真实存档）。 */
    autoplayCurrent(profile = "planner") {
      const g = G(); if (!g.run) return "no run";
      const bot = new Bot(profile, Date.now() & 0xffff);
      for (let k = 0; k < 20000; k++) {
        const v = g.next();
        if (v.type === "choice") g.choose(bot.choice(v, g));
        else if (v.type === "check") g.resolveCheck(bot.burn(v, g));
        else if (v.type === "phase") { const o = bot.phase(v, g); g.act(o.kind, o.id); }
        else if (v.type === "ending") { window.U7.ui.waiting = null; window.U7.pump(); return v.id; }
      }
    },
  };
  window.U7.test = test;

  function render() {
    const g = G(), r = g.run;
    const stats = r ? Object.entries(r.stats).map(([k, v]) => `${k}<input data-stat="${k}" value="${v}">`).join(" ") : "(无进行中的周目)";
    P.innerHTML = `
      <h4>■ 内部测试接口 <button data-x="close">关闭</button></h4>
      <div>周目 ${g.meta.loops} · 完成 ${g.meta.runsCompleted} · Insight ${g.insight} · 信物 ${g.meta.relics.length}/6 · 道具 ${g.meta.aids.length}/6 · 钥匙 ${g.meta.keys.length}/2</div>
      ${r ? `<div>化身 ${r.route} · Day ${r.day} · ${r.stage} · AP ${r.ap} · 场景 ${r.script ? r.script.scene : "-"}</div>` : ""}
      <h4>属性</h4><div>${stats} ${r ? '<button data-x="stats">应用</button>' : ""}</div>
      <h4>观测深度 / 进度</h4>
      <div>Insight <input id="dbg-ins" value="${g.insight}"><button data-x="ins">设置</button>
        <button data-x="relic">全信物</button><button data-x="aid">全道具</button><button data-x="key">全钥匙</button><button data-x="l7">解锁第七周目</button></div>
      <h4>跳转</h4>
      <div>Day <input id="dbg-day" value="${r ? r.day : 1}"> <select id="dbg-stage">${["dawn", "morning", "noon", "dusk", "event", "festival", "finale"].map((s) => `<option>${s}</option>`).join("")}</select><button data-x="jump">跳转</button></div>
      <div>场景 <input id="dbg-scene" style="width:150px" placeholder="如 rina_d5"><button data-x="scene">播放</button></div>
      ${r ? `<h4>NPC</h4><div>${Object.entries(r.npc).map(([k, n]) => `${k}:<button data-npc="${k}" data-f="alive">${n.alive ? "生" : "死"}</button><button data-npc="${k}" data-f="aided">${n.aided ? "已援" : "未援"}</button>`).join(" ")}</div>` : ""}
      <h4>决策树模拟（独立副本，不影响存档）</h4>
      <div><select id="dbg-prof"><option>blind</option><option>casual</option><option>planner</option><option>random</option></select> 局数 <input id="dbg-n" value="100"><button data-x="sim">运行</button>
        ${r ? '<button data-x="auto">机器人接管本周目</button>' : ""}</div>
      <pre id="dbg-out"></pre>
      <h4>存档</h4><div><button data-x="export">导出</button><button data-x="import">导入</button><button data-x="reset">重置全部</button></div>
      <div style="margin-top:8px;color:#6a8">控制台：U7.test.setStat('POW',80) / jump(5,'dusk') / simulate('casual',200) / setInsight(100)</div>`;
  }
  P.addEventListener("click", (e) => {
    const x = e.target.dataset.x, out = document.getElementById("dbg-out");
    if (e.target.dataset.npc) { const n = G().run.npc[e.target.dataset.npc]; n[e.target.dataset.f] = !n[e.target.dataset.f]; window.U7.refresh(); return render(); }
    if (!x) return;
    if (x === "close") return P.classList.add("hidden");
    if (x === "stats") P.querySelectorAll("[data-stat]").forEach((i) => (G().run.stats[i.dataset.stat] = +i.value)), window.U7.refresh();
    if (x === "ins") test.setInsight(+document.getElementById("dbg-ins").value);
    if (x === "relic" || x === "aid" || x === "key") test.giveAll(x);
    if (x === "l7") test.unlockLoop7();
    if (x === "jump") test.jump(+document.getElementById("dbg-day").value, document.getElementById("dbg-stage").value);
    if (x === "scene") test.playScene(document.getElementById("dbg-scene").value.trim());
    if (x === "sim") { out.textContent = "模拟中……"; setTimeout(() => { const t0 = performance.now(); const r = test.simulate(document.getElementById("dbg-prof").value, +document.getElementById("dbg-n").value);
      out.textContent = Object.entries(r).map(([k, v]) => `${k.padEnd(8)} 通关 ${(v.clear * 100).toFixed(1)}%  D5 ${(v.d5 * 100).toFixed(1)}%  崩溃 ${(v.collapse * 100).toFixed(1)}%`).join("\n") + `\n(${((performance.now() - t0) / 1000).toFixed(1)}s)`; }, 30); return; }
    if (x === "auto") { out.textContent = "结局：" + test.autoplayCurrent(); }
    if (x === "export") { out.textContent = test.exportSave(); navigator.clipboard && navigator.clipboard.writeText(out.textContent); }
    if (x === "import") { const s = prompt("粘贴存档 JSON"); if (s) test.importSave(s); }
    if (x === "reset") test.resetMeta();
    render();
  });
  window.U7.toggleDebug = () => { P.classList.toggle("hidden"); if (!P.classList.contains("hidden")) render(); };
  if (/[?&]debug=1/.test(location.search)) window.U7.toggleDebug();
})();
