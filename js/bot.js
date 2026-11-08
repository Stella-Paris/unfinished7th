/* 决策树模拟玩家（浏览器测试面板与 Node 模拟器共用）。
 *   planner : 知道全部配置表（数值上限参考）
 *   casual  : 知道配置表，但偏好擅长属性、经常随性选择
 *   blind   : 不读配置表，只用界面上看得到的信息 + 自己的记忆（最接近真人第一次玩）
 *   random  : 完全随机
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine"));
  else root.Bot = factory(root.Engine);
})(typeof self !== "undefined" ? self : this, function (Engine) {
  "use strict";
  const { mulberry32 } = Engine;
  const STATS = ["INT", "CON", "POW"];

  class Bot {
    constructor(profile, seed) { this.p = profile; this.r = mulberry32(seed); this.mem = {}; }
    rnd(n) { return Math.floor(this.r() * n); }
    pick(a) { return a[this.rnd(a.length)]; }

    /* ---------- 知道配置表的玩家：对后续危机的属性缺口 ---------- */
    deficits(g) {
      if (this.p === "blind") return this.blindTargets(g);
      const r = g.run, C = g.D.config.checks.checks, out = { INT: 0, CON: 0, POW: 0 };
      for (let d = r.day; d <= 6; d++) {
        const spec = C[`${r.route}_d${d}`];
        if (!spec) continue;
        const w = d === r.day ? 1.6 : d === 5 ? 1.3 : 1;
        const gaps = Object.entries(spec.req).filter(([k]) => k !== "SAN").map(([k, need]) => [k, Math.max(0, need + 2 - r.stats[k])]);
        if (spec.mode === "any") { gaps.sort((a, b) => a[1] - b[1]); if (gaps[0]) out[gaps[0][0]] = Math.max(out[gaps[0][0]], gaps[0][1] * w); }
        else for (const [k, v] of gaps) out[k] = Math.max(out[k], v * w);
      }
      if (r.route === "hero") { const F = g.B.final_check; for (const k of ["INT", "POW"]) out[k] = Math.max(out[k], F[k] + 4 - r.stats[k]); }
      return out;
    }
    sanNeed(g) {
      if (this.p === "blind") {   // 只知道自己记住的：某天有理智检定、需求是多少（或失败时的估计）
        const e = (this.mem[g.run.route] || {})[g.run.day];
        if (e && "SAN" in e.need) return Math.max(50, (e.need.SAN != null ? e.need.SAN : (e.have.SAN || 60) + 10) + 3);
        return 50;
      }
      const r = g.run, C = g.D.config.checks.checks; let need = 45;
      for (let d = r.day; d <= Math.min(6, r.day + 1); d++) { const s = C[`${r.route}_d${d}`]; if (s && s.req.SAN) need = Math.max(need, s.req.SAN + 3); }
      return need;
    }

    /* ---------- 盲玩：只用界面可见信息 + 记忆 ---------- */
    blindTargets(g) {
      const r = g.run, out = { INT: 0, CON: 0, POW: 0 };
      // 1) 直觉警示（Insight≥30 时界面会显示）
      const intu = g.intuition();
      if (intu) for (const x of intu) if (x.stat !== "SAN") out[x.stat] = Math.max(out[x.stat], (x.need + 3 - x.have) * (x.day === r.day ? 1.5 : 1));
      // 2) 记忆：以前在这条线上见过的判定（数值可见则记住数值；不可见则按失败时的属性估计）
      const m = this.mem[r.route] || {};
      for (let d = r.day; d <= 6; d++) {
        const e = m[d]; if (!e) continue;
        for (const [k, need] of Object.entries(e.need)) {
          if (k === "SAN") continue;
          const est = need != null ? need : e.failed ? (e.have[k] || 0) + 10 : 0;
          out[k] = Math.max(out[k], (est + 2 - r.stats[k]) * (d === 5 ? 1.3 : 1));
        }
      }
      // 3) 什么都不知道：均衡发展（补最低的一项）
      if (STATS.every((k) => out[k] <= 0)) {
        const low = STATS.slice().sort((a, b) => r.stats[a] - r.stats[b])[0];
        out[low] = 1;
      }
      return out;
    }
    observe(v, res, g) { // 判定结束后记忆（只记录界面上显示过的内容）
      if (this.p !== "blind" || v.id === "final" || v.id === "anomaly") return;
      const r = g.run, d = +v.id.split("_d")[1];
      const m = (this.mem[r.route] = this.mem[r.route] || {});
      const prev = m[d] || { need: {}, have: {}, failed: false };
      for (const row of v.rows) {
        if (v.reveal) prev.need[row.stat] = row.need;
        else if (!(row.stat in prev.need)) prev.need[row.stat] = null;
        prev.have[row.stat] = Math.max(prev.have[row.stat] || 0, row.have);
      }
      prev.failed = prev.failed || !res.ok;
      m[d] = prev;
    }

    /* ---------- 行动阶段 ---------- */
    phase(v, g) {
      const r = g.run, opts = v.options.filter((o) => !o.done && !o.closed);
      if (this.p === "random") return this.pick(opts);
      const def = this.deficits(g);
      const apt = g.char(r.route).apt;
      const blind = this.p === "blind";
      if (v.stage === "morning") {
        if (this.p === "casual") {
          if (this.r() < 0.35) return this.pick(opts);
          const best = STATS.slice().sort((a, b) => apt[b] - apt[a])[0];
          const tot = STATS.reduce((s, k) => s + def[k], 0);
          if (tot > 0 && this.r() < 0.5) { const k = STATS.slice().sort((a, b) => def[b] - def[a])[0]; return opts.find((o) => o.stat === k); }
          return opts.find((o) => o.stat === best);
        }
        if (blind && this.r() < 0.2) return this.pick(opts);       // 真人偶尔凭感觉
        const div = blind ? { INT: 1, CON: 1, POW: 1 } : apt;       // 盲玩看不到成长倍率
        const k = STATS.slice().sort((a, b) => def[b] / div[b] - def[a] / div[a] || div[b] - div[a])[0];
        if (def[k] <= 0) return opts.find((o) => o.stat === (r.route === "chiyo" || r.route === "yune" ? "INT" : "POW"));
        return opts.find((o) => o.stat === k);
      }
      if (v.stage === "noon") {
        const lowSan = r.stats.SAN < this.sanNeed(g) + 10;
        const score = (o) => {
          let s = (o.fx.SAN || 0) * (lowSan ? 2 : 0.4);
          for (const k of STATS) s += (o.fx[k] || 0) * (def[k] > 0 ? 1.5 : 0.3);
          if (o.count > 0 && o.count < o.need) s += 1.5;   // 冲羁绊技能
          if (this.p === "casual" || blind) s += this.r() * 4;
          return s;
        };
        return opts.sort((a, b) => score(b) - score(a))[0];
      }
      if (v.stage === "dusk") {
        const del = opts.find((o) => o.kind === "deliver");
        if (del && (this.p === "planner" || this.r() < (blind ? 0.8 : 0.5))) return del;
        const san = r.stats.SAN, need = this.sanNeed(g);
        const locs = opts.filter((o) => o.kind === "explore" && !o.rest);
        const cost = (o) => (o.preview ? o.preview.san : 0) + (o.clue ? 4 : 0);
        const safe = (o) => san - cost(o) >= need;
        const fresh = locs.filter((o) => o.newInsight && safe(o));   // 金色「!」：界面可见
        if (fresh.length && (this.p === "planner" || this.r() < 0.6)) return this.pick(fresh);
        const safeLocs = locs.filter(safe);
        if (san < need || !safeLocs.length) {
          // 理智吃紧：休息或去疗养型地点
          const heal = locs.filter((o) => o.preview && o.preview.san < 0);
          return this.r() < 0.5 && heal.length ? this.pick(heal) : opts.find((o) => o.rest);
        }
        const sanW = san < need + 15 ? 0.9 : 0.3;
        const score = (o) => {
          const p = o.preview; let s = 0;
          if (!safe(o)) s -= 50;   // 给今晚可能的理智检定留余量
          for (const [k, w] of Object.entries(p.weights)) s += w * (def[k] > 0 ? 3 : 0.6);
          s -= p.san * sanW;
          if (o.clue) s += 1;
          if (this.p !== "planner") s += this.r() * 3;
          return s;
        };
        return locs.sort((a, b) => score(b) - score(a))[0];
      }
    }

    /* ---------- 选项 ---------- */
    choice(v, g) {
      if (this.p === "random") return this.rnd(v.opts.length);
      const st = v.opts.map((o) => o.stance);
      if (st.includes("resolve")) {           // 地点异常：处理 or 绕开
        const iRes = st.indexOf("resolve"), iAv = st.indexOf("avoid");
        if (this.p === "planner") { const spec = g.checkSpec("anomaly"); return g.evalCheck(spec, 0, false) ? iRes : iAv; }
        if (this.p === "blind") return this.r() < (g.run.stats.SAN > 50 ? 0.7 : 0.3) ? iRes : iAv;
        return this.r() < 0.6 ? iRes : iAv;
      }
      if (this.p === "blind") return this.rnd(v.opts.length);   // 不知道抉择修正，凭直觉
      const spec = g.D.config.checks.checks[`${g.run.route}_d${g.run.day}`];
      if (!spec || !spec.stance) return this.rnd(v.opts.length);
      const bonus = v.opts.map((o) => (o.stance && spec.stance[o.stance] ? spec.stance[o.stance].bonus : 0));
      if (this.p === "casual" && this.r() < 0.4) return this.rnd(v.opts.length);
      return bonus.indexOf(Math.max(...bonus));
    }

    /* ---------- 燃烧理智 ---------- */
    burn(v, g) {
      if (!v.burnable) return false;
      const san = g.run.stats.SAN, B = g.B.burn_san;
      if (this.p === "blind") {
        if (v.reveal || v.id === "final") {           // 数值可见：自己算
          if (v.pass) return false;
          const ok = v.rows.every((x) => (x.stat === "SAN" ? x.have - B.cost : x.have + B.bonus) >= x.need) || (v.mode === "any" && v.rows.some((x) => x.stat !== "SAN" && x.have + B.bonus >= x.need));
          return ok && (v.fatal || v.id === "final" || san - B.cost >= 45);
        }
        if (v.fatal) return san - B.cost >= 30;      // 看不到数值：生死关头赌一把
        return san > 70 && this.r() < 0.2;
      }
      if (v.pass) return false;
      const can = g.evalCheck(g.checkSpec(v.id), v.bonus, true);
      if (!can) return false;
      if (this.p === "random") return this.r() < 0.5;
      return v.fatal || v.id === "final" || san - B.cost >= 45;
    }
  }

  function playRun(g, bot, route, stats) {
    g.startRun(route);
    for (let guard = 0; guard < 20000; guard++) {
      const v = g.next();
      switch (v.type) {
        case "line": case "cmd": case "summary": break;
        case "choice": g.choose(bot.choice(v, g)); break;
        case "check": {
          const burn = bot.burn(v, g);
          if (stats && /_d5$/.test(v.id)) {
            const extra = burn ? g.B.burn_san.bonus : 0;
            const m = Math.min(...v.rows.filter((x) => x.stat !== "SAN").map((x) => x.have + extra - x.need));
            stats.margin = (stats.margin || 0) + m; stats.marginN = (stats.marginN || 0) + 1;
          }
          const res = g.resolveCheck(burn);
          bot.observe(v, res, g);
          if (stats) {
            const k = v.id; stats.checks[k] = stats.checks[k] || [0, 0]; stats.checks[k][0]++; if (res.ok) stats.checks[k][1]++;
          }
          break;
        }
        case "phase": {
          const o = bot.phase(v, g);
          const res = g.act(o.kind, o.id);
          if (stats && o.kind === "explore") {
            stats.dusk = stats.dusk || { visits: 0, rest: 0, anomaly: 0, encounter: 0 };
            stats.dusk.visits++; if (o.rest) stats.dusk.rest++;
            if (res.visit && res.visit.kind === "anomaly") stats.dusk.anomaly++;
            if (res.visit && res.visit.kind === "encounter") stats.dusk.encounter++;
          }
          break;
        }
        case "ending": { const id = v.id; const r = g.run; g.endRun(); return { id, day: r.day, stats: r.stats, skills: r.skills.length, npc: r.npc }; }
        default: throw new Error("unexpected " + v.type);
      }
    }
    throw new Error("run did not terminate");
  }

  return { Bot, playRun };
});
