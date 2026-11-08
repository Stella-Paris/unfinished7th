#!/usr/bin/env node
/* 自动调参：以「盲玩」机器人（不读配置表，只看界面信息）的首周目体验为主要目标，
 * 同时用 planner（知道全部数值）约束上限、random 约束下限。坐标搜索。
 * 用法: node dev/tune.js [--iters 4] [--n 150] [--write]
 *   --write  把结果写回 config/balance.json、config/characters.json，并生成 dev/sim_report.md
 */
const fs = require("fs");
const path = require("path");
const { compile } = require("./build");
const { routeStats, campaignStats } = require("./sim");
const ROOT = path.join(__dirname, "..");

// 设计目标：真人第一次玩某条线 ≈ 45% 能撑到第七日（死一次再来是轮回设计的一部分）
const TARGET = {
  blind_clear: 0.45,      // 盲玩首周目通关率
  blind_collapse: 0.05,   // 盲玩因 SAN 崩溃的比例（理智要有压力，但不应是主要死因）
  blind_d5: 0.55,         // 盲玩到达 Day5 后的生死判定通过率
  planner_margin: 5,      // 规划型玩家 Day5 最弱属性平均余量（上限不能太松）
  random_clear: 0.10,     // 完全随机玩家（越低越好，不超过此值不计罚）
};

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg("n", 150), ITERS = +arg("iters", 4);
const { data } = compile({ quiet: true });
const C = data.config, G = C.characters.playable, B = C.balance;
const MACRO_BASE = B.macro_san_loss.slice();

const P = [
  { k: "class_gain", v: B.class_gain.base, step: 0.4, lo: 2, hi: 7, set: (x) => (B.class_gain.base = x) },
  { k: "macro_scale", v: 1.0, step: 0.2, lo: 0.3, hi: 2, set: (x) => (B.macro_san_loss = MACRO_BASE.map((b) => Math.round(b * x))) },
  { k: "burn_bonus", v: B.burn_san.bonus, step: 2, lo: 4, hi: 14, int: true, set: (x) => (B.burn_san.bonus = x) },
  { k: "dusk_gain", v: B.dusk_train.gain_mult, step: 0.2, lo: 0.6, hi: 2.5, set: (x) => (B.dusk_train.gain_mult = x) },
  { k: "dusk_san", v: B.dusk_train.san_cost, step: 1, lo: 2, hi: 9, int: true, set: (x) => (B.dusk_train.san_cost = x) },
  { k: "anomaly_base", v: B.dusk_train.anomaly_need.base, step: 3, lo: 5, hi: 30, int: true, set: (x) => (B.dusk_train.anomaly_need.base = x) },
  ...G.map((g) => ({ k: "apt_" + g, v: 1.0, step: 0.06, lo: 0.7, hi: 1.3, g, base: { ...C.characters.chars[g].apt },
    set(x) { const a = C.characters.chars[g].apt; for (const s in this.base) a[s] = +(this.base[s] * x).toFixed(3); } })),
];

function evaluate() {
  const bl = routeStats(data, "blind", N, 41), pl = routeStats(data, "planner", Math.ceil(N / 2), 11), ra = routeStats(data, "random", Math.ceil(N / 2), 37);
  const mean = (o, f) => G.reduce((s, g) => s + f(o[g]), 0) / G.length;
  const m = {
    blind_clear: mean(bl, (s) => s.survive), blind_collapse: mean(bl, (s) => s.collapse), blind_d5: mean(bl, (s) => s.d5pass),
    planner_margin: mean(pl, (s) => s.margin), random_clear: mean(ra, (s) => s.survive),
  };
  let loss = 4 * (m.blind_clear - TARGET.blind_clear) ** 2 + 3 * (m.blind_collapse - TARGET.blind_collapse) ** 2 +
             2 * (m.blind_d5 - TARGET.blind_d5) ** 2 + 0.004 * (m.planner_margin - TARGET.planner_margin) ** 2 +
             3 * Math.max(0, m.random_clear - TARGET.random_clear) ** 2;
  for (const g of G) loss += 1.5 * (bl[g].survive - m.blind_clear) ** 2 + 0.001 * (pl[g].margin - m.planner_margin) ** 2;
  return { loss, m, bl, pl, ra };
}

let best = evaluate();
console.log("initial", best.loss.toFixed(4), JSON.stringify(best.m));
for (let it = 0; it < ITERS; it++) {
  for (const p of P) {
    for (const dir of [1, -1]) {
      let x = p.v + dir * p.step; if (p.int) x = Math.round(x);
      if (x < p.lo || x > p.hi || x === p.v) continue;
      p.set(x);
      const e = evaluate();
      if (e.loss < best.loss - 1e-5) { best = e; p.v = x; console.log(`it${it} ${p.k}=${(+x).toFixed(3)} loss=${e.loss.toFixed(4)}`); break; }
      p.set(p.v);
    }
  }
  for (const p of P) p.step = p.int ? Math.max(1, Math.round(p.step / 1.6)) : p.step / 1.6;
}
console.log("final", best.loss.toFixed(4), JSON.stringify(best.m));
console.log("params", P.map((p) => `${p.k}=${(+p.v).toFixed(3)}`).join(" "));

if (process.argv.includes("--write")) {
  const bal = JSON.parse(fs.readFileSync(path.join(ROOT, "config/balance.json"), "utf8"));
  bal.class_gain.base = +B.class_gain.base.toFixed(2); bal.macro_san_loss = B.macro_san_loss; bal.burn_san.bonus = B.burn_san.bonus;
  bal.dusk_train.gain_mult = +B.dusk_train.gain_mult.toFixed(2); bal.dusk_train.san_cost = B.dusk_train.san_cost;
  bal.dusk_train.anomaly_need.base = B.dusk_train.anomaly_need.base;
  fs.writeFileSync(path.join(ROOT, "config/balance.json"), JSON.stringify(bal, null, 2) + "\n");
  let chars = fs.readFileSync(path.join(ROOT, "config/characters.json"), "utf8");
  for (const g of G) {
    const a = C.characters.chars[g].apt;
    chars = chars.replace(new RegExp(`("${g}":[\\s\\S]*?"apt": )\\{[^}]*\\}`), `$1{"INT": ${a.INT}, "CON": ${a.CON}, "POW": ${a.POW}}`);
  }
  fs.writeFileSync(path.join(ROOT, "config/characters.json"), chars);

  const ca = routeStats(data, "casual", N, 23);
  const camp = { blind: campaignStats(data, "blind", 150), planner: campaignStats(data, "planner", 150), casual: campaignStats(data, "casual", 150) };
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const cn = (g) => C.characters.chars[g].full;
  let md = `# 数值模拟报告\n\n生成时间：${new Date().toISOString()}\n\n`;
  md += `玩家模型：**blind 盲玩**（不读配置表，只用界面可见信息：属性、卡片上的效果与SAN消耗、金色「!」、Insight≥30后的判定数值与直觉警示；记得自己见过的判定；剧情抉择凭直觉随机）· **planner**（知道全部数值）· **casual**（知道数值但随性）· **random**（完全随机）。\n`;
  md += `每角色每模型模拟 ${N} 局（planner/random 各 ${Math.ceil(N / 2)} 局），战役各 150 次。**调参以 blind 为主要目标。**\n\n`;
  md += `## 调参结果\n\n| 参数 | 值 |\n|---|---|\n` + P.map((p) => `| ${p.k} | ${(+p.v).toFixed(3)} |`).join("\n") + "\n\n";
  md += `## 目标达成\n\n| 指标 | 目标 | 实测 |\n|---|---|---|\n` + Object.keys(TARGET).map((k) => k === "planner_margin" ? `| ${k} | +${TARGET[k]} | +${best.m[k].toFixed(1)} |` : `| ${k} | ${k === "random_clear" ? "≤" : ""}${pct(TARGET[k])} | ${pct(best.m[k])} |`).join("\n") + "\n\n";
  md += `## 各角色线（首周目，无任何记忆）\n\n| 角色 | 盲玩 通关 | 盲玩 D5 | 盲玩 SAN崩溃 | 盲玩 黄昏 休息/异常/偶遇 | 随性 通关 | 规划 D5余量 | 随机 通关 |\n|---|---|---|---|---|---|---|---|\n` +
    G.map((g) => { const b = best.bl[g]; return `| ${cn(g)} | ${pct(b.survive)} | ${pct(b.d5pass)} | ${pct(b.collapse)} | ${pct(b.dusk.rest)} / ${pct(b.dusk.anomaly)} / ${pct(b.dusk.encounter)} | ${pct(ca[g].survive)} | +${best.pl[g].margin.toFixed(1)} | ${pct(best.ra[g].survive)} |`; }).join("\n") + "\n\n";
  md += `### 盲玩各日检定通过率\n\n| 角色 | D1 | D2 | D3 | D4 | D5 | D6 |\n|---|---|---|---|---|---|---|\n` +
    G.map((g) => `| ${g} | ` + [1, 2, 3, 4, 5, 6].map((d) => (best.bl[g].checks[`${g}_d${d}`] != null ? pct(best.bl[g].checks[`${g}_d${d}`]) : "—")).join(" | ") + " |").join("\n") + "\n\n";
  md += `## 完整战役（直到真结局，上限30周目；盲玩会记住自己见过的判定）\n\n| 指标 | 盲玩 | 规划型 | 随性型 |\n|---|---|---|---|\n`;
  const row = (name, f) => `| ${name} | ${f(camp.blind)} | ${f(camp.planner)} | ${f(camp.casual)} |\n`;
  md += row("达成真结局比例", (c) => pct(c.teRate)) + row("真结局所需周目(均值/中位)", (c) => `${c.runsToTE.mean} / ${c.runsToTE.median}`) +
    row("Insight≥30 所需周目", (c) => c.runsToInsight30) + row("Insight≥60 所需周目", (c) => c.runsToInsight60) +
    row("Insight=100 所需周目", (c) => `${c.runsToInsight100.mean} (达成率 ${pct(c.runsToInsight100.reached)})`) +
    row("首次通关全部6条角色线所需周目", (c) => c.runsToAllCleared) + row("平均死亡次数", (c) => c.deathsPerCampaign) +
    row("结局分布", (c) => Object.entries(c.endings).map(([k, v]) => `${k}:${v}`).join(" "));
  fs.writeFileSync(path.join(__dirname, "sim_report.md"), md);
  console.log("written config + dev/sim_report.md");
  console.log(JSON.stringify(camp));
}
