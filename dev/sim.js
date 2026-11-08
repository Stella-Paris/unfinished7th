#!/usr/bin/env node
/* 内部测试：决策树模拟玩家，大量模拟游玩并统计数值表现。
 * 用法: node dev/sim.js [--n 2000] [--profile planner|casual|random] [--campaigns 300] [--json]
 * 与浏览器共用 js/engine.js，因此结果与真实游戏逻辑一致。
 */
const path = require("path");
const { compile } = require("./build");
const { Game } = require("../js/engine");
const { Bot, playRun } = require("../js/bot");

/* ---------------- 单角色首周目通过率 ---------------- */
function routeStats(data, profile, n, seed0 = 1) {
  const res = {};
  for (const route of data.config.characters.playable) {
    const st = { checks: {}, endings: {}, d5: 0, collapse: 0, n };
    for (let i = 0; i < n; i++) {
      const g = new Game(data, { seed: seed0 * 1000003 + i * 7919 });
      const out = playRun(g, new Bot(profile, seed0 + i * 31), route, st);
      st.endings[out.id] = (st.endings[out.id] || 0) + 1;
    }
    const d5 = st.checks[`${route}_d5`] || [0, 0];
    const du = st.dusk || { visits: 1 };
    res[route] = { dusk: { rest: (du.rest || 0) / du.visits, anomaly: (du.anomaly || 0) / du.visits, encounter: (du.encounter || 0) / du.visits }, survive: (st.endings.route_clear || 0) / n, collapse: (st.endings.be_collapse || 0) / n,
                   d5pass: d5[0] ? d5[1] / d5[0] : 0, margin: st.marginN ? st.margin / st.marginN : 0, checks: Object.fromEntries(Object.entries(st.checks).map(([k, [a, b]]) => [k, +(b / a).toFixed(3)])) };
  }
  return res;
}

/* ---------------- 完整战役（直到真结局或上限） ---------------- */
function campaign(data, profile, seed, maxRuns = 30) {
  const g = new Game(data, { seed });
  const bot = new Bot(profile, seed * 13 + 5);
  const order = data.config.characters.playable.slice();
  const marks = { ins30: null, ins60: null, ins100: null, allCleared: null, ne: null, te: null };
  const endings = [];
  for (let run = 1; run <= maxRuns; run++) {
    let route;
    const uncleared = order.filter((x) => !g.meta.cleared[x]);
    if (uncleared.length) route = uncleared[0];
    else if (!g.loop7Unlocked()) route = order[run % 6];
    else {
      const needMore = g.insight < 100 || !g.meta.keys.includes("key_extra") || !g.meta.keys.includes("key_musicbox");
      // 若观测深度/关键道具不足，挑一条还有未获取 Insight 的角色线再走一遍；否则挑战终章
      if (needMore && endings.filter((e) => e === "ne" || e === "be_white").length >= 1 && run % 2 === 0) {
        const C = data.config.checks.checks;
        route = profile === "blind" ? order[Math.floor(((seed * 7 + run * 13) % 60) / 10)]   // 盲玩看不到 Insight 来源，随手挑一位
          : order.map((x) => [x, [2, 3, 4, 5, 6].filter((d) => g.meta.insightFlags[`${x}_d${d}`] == null).length]).sort((a, b) => b[1] - a[1])[0][0];
      } else route = "hero";
    }
    const out = playRun(g, bot, route);
    endings.push(out.id);
    const ins = g.insight;
    if (marks.ins30 == null && ins >= 30) marks.ins30 = run;
    if (marks.ins60 == null && ins >= 60) marks.ins60 = run;
    if (marks.ins100 == null && ins >= 100) marks.ins100 = run;
    if (marks.allCleared == null && order.every((x) => g.meta.cleared[x])) marks.allCleared = run;
    if (out.id === "ne" && marks.ne == null) marks.ne = run;
    if (out.id === "te") { marks.te = run; break; }
  }
  return { marks, endings, insight: g.insight, keys: g.meta.keys.length, deaths: g.meta.deaths };
}

function campaignStats(data, profile, n, seed0 = 7) {
  const agg = { te: [], ne: [], ins30: [], ins60: [], ins100: [], allCleared: [], deaths: [], teRate: 0, endings: {} };
  for (let i = 0; i < n; i++) {
    const c = campaign(data, profile, seed0 + i * 101);
    for (const k of ["te", "ne", "ins30", "ins60", "ins100", "allCleared"]) if (c.marks[k] != null) agg[k].push(c.marks[k]);
    agg.deaths.push(c.deaths);
    if (c.marks.te) agg.teRate++;
    for (const e of c.endings) agg.endings[e] = (agg.endings[e] || 0) + 1;
  }
  const mean = (a) => (a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) : null);
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return { n, teRate: agg.teRate / n, runsToTE: { mean: mean(agg.te), median: med(agg.te) }, runsToNE: mean(agg.ne),
           runsToInsight30: mean(agg.ins30), runsToInsight60: mean(agg.ins60), runsToInsight100: { mean: mean(agg.ins100), reached: agg.ins100.length / n },
           runsToAllCleared: mean(agg.allCleared), deathsPerCampaign: mean(agg.deaths), endings: agg.endings };
}

module.exports = { Bot, playRun, routeStats, campaign, campaignStats };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
  const n = +arg("n", 400), camp = +arg("campaigns", 150);
  const { data } = compile({ quiet: true });
  const out = {};
  for (const p of (arg("profile", "blind,planner,casual,random")).split(",")) {
    out[p] = { routes: routeStats(data, p, n) };
    if (p !== "random") out[p].campaign = campaignStats(data, p, camp);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
  else for (const [p, o] of Object.entries(out)) {
    console.log(`\n=== profile: ${p} ===`);
    for (const [g, s] of Object.entries(o.routes))
      console.log(`${g.padEnd(8)} survive=${(s.survive * 100).toFixed(1)}% d5=${(s.d5pass * 100).toFixed(1)}% collapse=${(s.collapse * 100).toFixed(1)}%  ` +
        Object.entries(s.checks).filter(([k]) => k.includes("_d")).map(([k, v]) => `${k.split("_")[1]}:${Math.round(v * 100)}`).join(" "));
    if (o.campaign) console.log("campaign:", JSON.stringify(o.campaign));
  }
}
