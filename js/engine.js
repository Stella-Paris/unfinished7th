/* 未完的第七日 — 核心引擎（纯逻辑，无 DOM）。浏览器与 Node 模拟器共用。
 * 交互模型：ui/bot 反复调用 next() 取得下一条指令，再用 advance()/choose()/resolveCheck()/act() 回应。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const STATS = ["INT", "CON", "POW"];
  const STAGES_AP = { morning: "class", noon: "activity", dusk: "explore" };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newMeta() {
    return { v: 1, insightFlags: {}, relics: [], aids: [], keys: [], endings: {}, cleared: {},
             runsCompleted: 0, loops: 0, seen: {}, deaths: 0 };
  }

  class Game {
    constructor(data, opts = {}) {
      this.D = data;                 // compiled GAME_DATA (config + scenes)
      this.B = data.config.balance;
      this.meta = opts.meta || newMeta();
      this.run = null;
      this.listeners = [];
      this.seedBase = opts.seed != null ? opts.seed : (Date.now() & 0xffffffff);
    }

    /* ---------------- helpers ---------------- */
    get insight() {
      let s = 0; for (const k in this.meta.insightFlags) s += this.meta.insightFlags[k];
      return Math.min(this.B.insight.max, s);
    }
    rand() { const r = this.run; const f = mulberry32(r.seed + r.rc++ * 7919); return f(); }
    emit(ev) { for (const f of this.listeners) f(ev); }
    char(id) { return this.D.config.characters.chars[id]; }
    get avatar() { return this.run ? this.run.route : "hero"; }
    sanState(s = this.run.stats.SAN) {
      const b = this.B.san;
      return s < b.collapse_below ? "collapse" : s < b.disturbed_below ? "disturbed" : "stable";
    }
    loop7Unlocked() { return this.meta.runsCompleted >= this.B.loop7_unlock_runs; }
    grantInsight(id, n) {
      if (!n || this.meta.insightFlags[id] != null) return 0;
      const before = this.insight;
      this.meta.insightFlags[id] = n;
      const gained = this.insight - before;
      if (gained > 0) {
        this.emit({ type: "insight", id, n: gained, total: this.insight });
        if (this.run) this.run.log.push({ day: this.run.day, insight: gained, id });
        for (const t of [this.B.insight.intuition_at, this.B.insight.transfer_at, this.B.insight.true_end_at])
          if (before < t && this.insight >= t) this.emit({ type: "insight_tier", at: t });
      }
      return gained;
    }

    /* ---------------- run lifecycle ---------------- */
    canStart(route) {
      if (route === "hero") return this.loop7Unlocked();
      return this.D.config.characters.playable.includes(route);
    }
    startRun(route, seed) {
      const c = this.char(route);
      this.meta.loops++;
      const npc = {};
      for (const g of this.D.config.characters.playable) if (g !== route) npc[g] = { alive: true, aided: false };
      this.run = {
        route, loop: this.meta.loops, day: 1, stage: "dawn", ap: 0,
        seed: (seed != null ? seed : this.seedBase + this.meta.loops * 104729) >>> 0, rc: 0,
        stats: { INT: c.base.INT, CON: c.base.CON, POW: c.base.POW, SAN: c.base.SAN },
        flags: {}, items: [], injury: 0, rehearse: {}, todayDone: {}, skills: [], npc,
        seenClues: {}, delivered: {}, resolved: {}, visit: null, queue: [], script: null, ended: null, pendingEnding: null,
        log: [], dayLog: [], checks: {}, entered: false,
      };
      this.enterStage();
      return this.run;
    }

    enterStage() {
      const r = this.run, B = this.B;
      r.entered = true;
      switch (r.stage) {
        case "dawn": {
          r.todayDone = {}; r.dayLog = [];
          if (r.day > 1) this.applyFx({ SAN: B.san.daily_regen }, "晨间恢复");
          const loss = B.macro_san_loss[r.day] || 0;
          if (loss) this.applyFx({ SAN: -loss }, "校园异变");
          const m = this.D.config.world.macro[r.day];
          if (r.day === 1 && r.route !== "hero") r.queue.push(this.meta.seen.prologue ? "loop_start" : "prologue");
          r.queue.push(m.scene);
          if (r.day === 6) for (const g in r.npc) if (!r.npc[g].alive) r.queue.push("rumor_" + g);
          r.afterQueue = r.day === 7 ? "festival" : "morning";
          break;
        }
        case "morning": r.ap = Math.max(1, B.ap_per_phase - (r.injury > 0 ? B.injury.ap_penalty : 0));
          if (r.injury > 0) r.injury--; break;
        case "noon": r.ap = B.ap_per_phase; break;
        case "dusk": r.ap = B.ap_per_phase; break;
        case "event": r.queue.push(`${r.route}_d${r.day}`); r.afterQueue = "night"; break;
        case "night": this.resolveNight(); break;
        case "festival": r.queue.push("festival"); r.afterQueue = "finale"; break;
        case "finale": r.queue.push(`${r.route}_d7`); r.afterQueue = "over"; break;
      }
    }

    nextStage() {
      const r = this.run;
      const order = { dawn: r.afterQueue, morning: "noon", noon: "dusk", dusk: "event", event: "night",
                      festival: "finale" };
      if (r.stage === "night") { r.day++; r.stage = "dawn"; }
      else r.stage = order[r.stage] || r.afterQueue;
      this.enterStage();
    }

    resolveNight() {
      const r = this.run, B = this.B;
      const news = [];
      if (r.day === 2) {
        for (const g in r.npc) {
          const t = this.D.config.world.npc_injury_d2[g];
          if (!t) continue;
          const opts = t.split("|");
          news.push(opts[Math.floor(this.rand() * opts.length)]);
        }
      }
      if (r.day === 5) {
        for (const g in r.npc) {
          const n = r.npc[g];
          const p = n.aided ? B.npc_aided_survival : B.npc_base_survival;
          n.alive = this.rand() < p;
          const nm = this.char(g).full;
          if (n.alive) news.push(n.aided ? `${nm}：你交付的道具起了作用。她平安度过了今晚。` : `${nm}：传来消息——她挺过来了，但伤得不轻。`);
          else { news.push(`${nm}：……今晚之后，再也没有人见过她。`); this.applyFx({ SAN: -B.npc_death_san_loss }, "噩耗"); }
        }
      }
      r.nightNews = news;
    }

    /* ---------------- main pump ---------------- */
    next() {
      const r = this.run;
      if (!r) return { type: "hub" };
      if (r.ended) return { type: "ending", id: r.ended, info: this.D.config.world.endings[r.ended] };
      if (r.script) {
        const ins = this.stepScript();
        if (ins) return ins;
      }
      if (!r.script && r.visit && !r.visit.done) this.finishVisit();
      if (r.pendingEnding && !r.script) { return this.finishRun(r.pendingEnding); }
      if (this.run.stats.SAN < this.B.san.collapse_below && !r.collapsing) {
        r.collapsing = true; r.pendingEnding = "be_collapse"; this.startScene("collapse");
        return this.next();
      }
      if (r.queue.length) { this.startScene(r.queue.shift()); return this.next(); }
      if (STAGES_AP[r.stage] && r.ap > 0) return this.phaseView();
      if (r.stage === "night" && !r.nightShown) { r.nightShown = true; return { type: "summary", day: r.day, news: r.nightNews || [], log: r.dayLog }; }
      if (r.stage === "over") return this.finishRun("route_clear");
      r.nightShown = false;
      this.nextStage();
      return this.next();
    }

    phaseView() {
      const r = this.run, C = this.D.config;
      const v = { type: "phase", stage: r.stage, ap: r.ap, day: r.day, options: [] };
      if (r.stage === "morning") {
        for (const id in C.actions.classes) v.options.push({ kind: "class", id, ...C.actions.classes[id] });
      } else if (r.stage === "noon") {
        for (const id in C.actions.activities) {
          const a = C.actions.activities[id];
          const owner = a.owner;
          const closed = owner && r.npc[owner] && !r.npc[owner].alive;
          v.options.push({ kind: "activity", id, ...a, done: !!r.todayDone[id], closed,
                           count: r.rehearse[id] || 0, need: this.B.rehearsal_skill_at });
        }
      } else if (r.stage === "dusk") {
        for (const id in C.explore.locations) {
          const loc = C.explore.locations[id];
          const clue = this.findClue(id);
          v.options.push({ kind: "explore", id, ...loc, clue: !!clue,
                           newInsight: !!(clue && clue.insight && this.meta.insightFlags[clue.id] == null),
                           preview: loc.rest ? null : this.duskPreview(id) });
        }
        for (const d of this.deliverables()) v.options.push(d);
      }
      if (!v.options.some((o) => !o.done && !o.closed)) { r.ap = 0; return this.next(); }
      return v;
    }

    deliverables() {
      const r = this.run, out = [];
      if (!(r.route === "hero" || this.insight >= this.B.insight.transfer_at)) return out;
      for (const aid of this.meta.aids) {
        const it = this.D.config.items.items[aid];
        const g = it.owner;
        if (!r.npc[g] || r.delivered[aid] || !r.npc[g].alive) continue;
        if (r.day > it.deadline) continue;
        out.push({ kind: "deliver", id: aid, name: `交付【${it.name}】`, loc: it.deliver_loc, owner: g, deadline: it.deadline });
      }
      return out;
    }

    findClue(loc) {
      const r = this.run, m = this.meta;
      for (const c of this.D.config.explore.clues) {
        if (c.loc !== loc || r.seenClues[c.id]) continue;
        if (c.days && (r.day < c.days[0] || r.day > c.days[1])) continue;
        if (c.route && c.route !== r.route) continue;
        if (c.min_insight && this.insight < c.min_insight) continue;
        if (c.need && !c.need.every((x) => this.has(x))) continue;
        if (c.need_any && !c.need_any.some((x) => this.has(x))) continue;
        if (c.key && m.keys.includes(c.key)) continue;
        return c;
      }
      return null;
    }
    has(x) { const m = this.meta; return m.relics.includes(x) || m.keys.includes(x) || m.aids.includes(x) || !!this.run.flags[x]; }

    /* ---------------- player actions in AP phases ---------------- */
    act(kind, id) {
      const r = this.run, C = this.D.config, B = this.B;
      if (r.ap <= 0) throw new Error("no AP");
      let res = { kind, id, fx: {} };
      if (kind === "class") {
        const cl = C.actions.classes[id];
        const apt = (this.char(r.route).apt || {})[cl.stat] || 1;
        const g = B.class_gain;
        const v = Math.max(1, Math.round(g.base * apt * (g.rand_min + this.rand() * (g.rand_max - g.rand_min))));
        const fx = { [cl.stat]: v };
        const sc = B.class_san_cost[cl.stat]; if (sc) fx.SAN = -sc;
        res.fx = this.applyFx(fx, cl.name);
        res.scene = this.D.scenes["class_" + id] ? "class_" + id : null;
      } else if (kind === "activity") {
        const a = C.actions.activities[id];
        if (r.todayDone[id]) throw new Error("already rehearsed today");
        r.todayDone[id] = true;
        r.rehearse[id] = (r.rehearse[id] || 0) + 1;
        res.fx = this.applyFx(a.fx, a.name);
        if (r.rehearse[id] === B.rehearsal_skill_at && !r.skills.includes(id)) {
          r.skills.push(id); res.skill = a.skill;
          this.emit({ type: "skill", id, name: a.skill });
        }
        const variants = this.D.sceneGroups["act_" + id] || [];
        if (variants.length) res.scene = variants[(r.day - 1) % variants.length];
      } else if (kind === "explore") {
        const loc = C.explore.locations[id];
        if (loc.rest) { res.fx = this.applyFx({ SAN: B.rest_san }, "休息"); res.scene = "a_dorm1"; }
        else {
          // 分区：跨周目累计，每次探索开启下一区；全部开启后随机
          const m = this.meta; m.areaVisits = m.areaVisits || {};
          const cnt = m.areaVisits[id] || 0, areas = loc.areas || [{ name: loc.name, bg: loc.bg, level: 0 }];
          const ai = cnt < areas.length ? cnt : Math.floor(this.rand() * areas.length);
          m.areaVisits[id] = cnt + 1;
          const area = areas[ai];
          const bg = area.bg_late && r.day >= area.late_from ? area.bg_late : area.bg;
          r.visit = { loc: id, area: ai, areaName: area.name, level: area.level || 0, bg, newArea: cnt < areas.length,
                      kind: "ambient", girl: null, outcome: null, done: false };
          res.area = area.name; res.bg = bg; res.newArea = r.visit.newArea;
          const T = B.dusk_train, clue = this.findClue(id);
          if (clue) {
            r.visit.kind = "clue";
            r.seenClues[clue.id] = true;
            if (clue.fx) res.fx = this.applyFx(clue.fx, loc.name);
            if (clue.key && !this.meta.keys.includes(clue.key)) { this.meta.keys.push(clue.key); res.key = clue.key; }
            res.insight = this.grantInsight(clue.id, clue.insight);
            res.scene = clue.id; res.clue = true;
          } else if (loc.anomaly && !r.resolved[id] && this.rand() < T.anomaly_chance) {
            r.visit.kind = "anomaly";
            res.scene = loc.anomaly[Math.floor(this.rand() * loc.anomaly.length)];
          } else {
            const table = C.explore.encounters || {};
            const cands = Object.keys(r.npc).filter((g) => r.npc[g].alive && table[g] && table[g][id]);
            for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
            const girl = cands.find((g) => this.rand() < table[g][id]);
            const encs = girl && this.D.sceneGroups["enc_" + girl];
            if (encs && encs.length) {
              r.visit.kind = "encounter"; r.visit.girl = girl; res.girl = girl;
              res.scene = encs[Math.floor(this.rand() * encs.length)];
            } else {
              const pool = C.explore.ambient[id] || [];
              const a = pool[Math.floor(this.rand() * pool.length)];
              if (a) { res.fx = this.applyFx(a.fx, loc.name); res.scene = a.id; }
            }
          }
          res.visit = r.visit;
        }
      } else if (kind === "deliver") {
        const it = C.items.items[id];
        r.delivered[id] = true; r.npc[it.owner].aided = true;
        res.scene = "deliver_" + it.owner;
      }
      r.ap--;
      if (res.scene && this.D.scenes[res.scene]) this.startScene(res.scene);
      this.emit({ type: "act", res });
      return res;
    }

    /* ---------------- 黄昏特训 ---------------- */
    trainSan(id, v) {
      const r = this.run, T = this.B.dusk_train, loc = this.D.config.explore.locations[id];
      let c = T.san_cost * loc.train.san_factor;
      if (c > 0) {
        const out = v && v.outcome;
        if (out === "failed" || out === "avoided") c *= T.unresolved_mult;
        else if (out === "resolved" || r.resolved[id]) c *= T.resolved_mult;
        if (v && v.kind === "encounter") c *= T.encounter_mult;
      }
      return Math.round(c);  // 正数=消耗，负数=回复
    }
    duskPreview(id) {
      const loc = this.D.config.explore.locations[id], areas = loc.areas || [];
      const cnt = (this.meta.areaVisits || {})[id] || 0;
      return { stats: Object.keys(loc.train.stats), weights: loc.train.stats, san: this.trainSan(id, null),
               resolved: !!this.run.resolved[id], nextArea: cnt < areas.length ? areas[cnt].name : null,
               unlocked: Math.min(cnt, areas.length), areas: areas.length };
    }
    finishVisit() {
      const r = this.run, v = r.visit, B = this.B, T = B.dusk_train, loc = this.D.config.explore.locations[v.loc];
      v.done = true;
      const apt = this.char(r.route).apt || {}, g = B.class_gain, fx = {};
      for (const [k, w] of Object.entries(loc.train.stats)) {
        const roll = g.rand_min + this.rand() * (g.rand_max - g.rand_min);
        fx[k] = Math.max(1, Math.round(g.base * T.gain_mult * w * (apt[k] || 1) * (1 + T.level_bonus * v.level) * roll));
      }
      const san = this.trainSan(v.loc, v);
      if (san) fx.SAN = -san;
      const out = this.applyFx(fx, `特训·${loc.name}`);
      v.result = out;
      this.emit({ type: "train", loc: v.loc, name: loc.name, area: v.areaName, fx: out, outcome: v.outcome, girl: v.girl, kind: v.kind });
    }

    applyFx(fx, src) {
      const r = this.run, out = {};
      if (!fx) return out;
      for (const k of [...STATS, "SAN"]) {
        if (fx[k] == null) continue;
        const before = r.stats[k];
        let v = before + fx[k];
        if (k === "SAN") v = Math.min(this.B.san.max, v);
        r.stats[k] = Math.max(0, v);
        out[k] = r.stats[k] - before;
        if (out[k]) r.dayLog.push({ src, stat: k, d: out[k] });
      }
      if (fx.flag) r.flags[fx.flag] = true;
      if (fx.injury) { r.injury += fx.injury; out.injury = fx.injury; }
      if (fx.relic && !this.meta.relics.includes(fx.relic)) { this.meta.relics.push(fx.relic); out.relic = fx.relic; this.emit({ type: "relic", id: fx.relic }); }
      if (fx.key && !this.meta.keys.includes(fx.key)) { this.meta.keys.push(fx.key); out.key = fx.key; }
      if (fx.item) r.items.push(fx.item);
      return out;
    }

    /* ---------------- script runner ---------------- */
    startScene(id) {
      if (!this.D.scenes[id]) { this.run.script = null; return; }
      this.run.script = { scene: id, ip: 0, stance: null };
      this.meta.seen[id] = 1;
    }

    evalCond(c) {
      if (!c) return true;
      return c.split("&").every((t) => {
        t = t.trim(); let neg = false;
        if (t[0] === "!") { neg = true; t = t.slice(1); }
        let v;
        const r = this.run, m = this.meta;
        const mm = t.match(/^(\w+)(>=|<=|>|<|:)?(.*)$/);
        const [_, k, op, arg] = mm;
        const num = (x) => { const n = +arg; return op === ">=" ? x >= n : op === "<=" ? x <= n : op === ">" ? x > n : x < n; };
        switch (k) {
          case "flag": v = !!r.flags[arg]; break;
          case "insight": v = num(this.insight); break;
          case "SAN": case "INT": case "CON": case "POW": v = num(r.stats[k]); break;
          case "day": v = num(r.day); break;
          case "alive": v = !!(r.npc[arg] && r.npc[arg].alive); break;
          case "dead": v = !!(r.npc[arg] && !r.npc[arg].alive); break;
          case "aided": v = !!(r.npc[arg] && r.npc[arg].aided); break;
          case "relic": v = m.relics.includes(arg); break;
          case "relics": v = num(m.relics.length); break;
          case "key": v = m.keys.includes(arg); break;
          case "cleared": v = !!m.cleared[arg]; break;
          case "route": v = r.route === arg; break;
          case "skill": v = r.skills.includes(arg); break;
          case "skills": v = num(r.skills.length); break;
          case "allalive": v = Object.values(r.npc).every((n) => n.alive); break;
          case "loop": v = num(r.loop); break;
          case "seen": v = !!m.endings[arg]; break;
          case "check": v = r.checks[arg] === true; break;
          case "rand": v = this.rand() < +arg; break;
          default: v = false;
        }
        return neg ? !v : v;
      });
    }

    stepScript() {
      const r = this.run;
      while (r.script) {
        const sc = this.D.scenes[r.script.scene];
        if (r.script.ip >= sc.length) { this.endScript(); return null; }
        const cmd = sc[r.script.ip++];
        switch (cmd.t) {
          case "line": return this.lineView(cmd, r.script.scene + ":" + (r.script.ip - 1));
          case "choice": {
            const opts = cmd.opts.filter((o) => this.evalCond(o.cond));
            r.script.pendingChoice = opts;
            const st = this.sanState();
            return { type: "choice", opts: opts.map((o) => ({ text: this.subst(o.text), stance: o.stance })), san: st };
          }
          case "check": {
            r.script.pendingCheck = cmd;
            return this.checkView(cmd.id);
          }
          case "final": { r.script.pendingCheck = { id: "final", ok: cmd.ok, ng: cmd.ng }; return this.checkView("final"); }
          case "goto": this.jump(cmd.to); break;
          case "if": if (this.evalCond(cmd.cond)) this.jump(cmd.to); break;
          case "fx": this.applyFx(cmd.fx, r.script.scene); break;
          case "flag": r.flags[cmd.name] = true; break;
          case "insight": this.grantInsight(cmd.id, cmd.n); break;
          case "ending": r.pendingEnding = cmd.id; break;
          case "end": this.endScript(); return null;
          default:
            if (cmd.t === "cg" && cmd.a !== "off") (this.meta.cgSeen = this.meta.cgSeen || {})[cmd.a] = 1;
            return { type: "cmd", cmd };   // bg/bgm/sfx/show/hide/cg/fx — presentation only
        }
      }
      return null;
    }
    jump(to) { const st = this.run.script && this.run.script.stance; this.startScene(to); if (this.run.script) this.run.script.stance = st; }
    endScript() { this.run.script = null; }

    subst(s) {
      const c = this.char(this.avatar);
      return s.replace(/\{me\}/g, c.name).replace(/\{me_full\}/g, c.full).replace(/\{loop\}/g, this.run ? this.run.loop : "")
        .replace(/\{loc\}/g, this.run && this.run.visit ? this.D.config.explore.locations[this.run.visit.loc].name + "的" + this.run.visit.areaName : "这里");
    }

    lineView(cmd, rid) {
      const rd = (this.meta.read = this.meta.read || {}), read = !!rd[rid]; rd[rid] = 1;
      let who = cmd.who;
      if (who === "me") who = this.avatar;
      const voice = cmd.vk ? this.D.voice[(cmd.who === "me" ? this.avatar : "") + cmd.vk] || null : null;
      return { type: "line", who, name: who ? (this.char(who) || { name: who }).name : null,
               text: this.subst(cmd.text), inner: !!cmd.inner, voice, rid, read };
    }

    choose(i) {
      const r = this.run, opts = r.script.pendingChoice;
      let idx = i, slipped = false;
      if (this.sanState() === "disturbed" && opts.length > 1 && this.rand() < this.B.san.misclick_chance) {
        idx = (i + 1 + Math.floor(this.rand() * (opts.length - 1))) % opts.length; slipped = true;
      }
      const o = opts[idx];
      r.script.pendingChoice = null;
      if (o.fx) this.applyFx(o.fx, "选择");
      const stance = o.stance;
      if (stance === "avoid" && r.visit && !r.visit.done) r.visit.outcome = "avoided";
      this.jump(o.to);
      if (stance) r.script.stance = stance;
      return { idx, slipped };
    }

    /* ---------------- checks ---------------- */
    checkSpec(id) {
      if (id === "final") {
        const r = this.run, F = this.B.final_check;
        const allies = Object.values(r.npc).filter((n) => n.alive).length;
        const red = F.ally_reduction * allies;
        return { id, mode: "all", req: { INT: F.INT - red, POW: F.POW - red }, fatal: false, final: true,
                 skillBonus: r.skills.length * F.bond_skill_bonus, allies };
      }
      if (id === "anomaly") {
        const r = this.run, loc = this.D.config.explore.locations[r.visit.loc], A = this.B.dusk_train.anomaly_need;
        const stat = Object.entries(loc.train.stats).sort((a, b) => b[1] - a[1])[0][0];
        return { id, mode: "all", req: { [stat]: A.base + A.per_day * r.day }, ok: {}, ng: {}, anomaly: true };
      }
      return this.D.config.checks.checks[id];
    }
    checkView(id) {
      const spec = this.checkSpec(id), r = this.run;
      const stance = r.script.stance && spec.stance ? spec.stance[r.script.stance] : null;
      const bonus = (stance ? stance.bonus : 0) + (spec.skillBonus || 0);
      const rows = Object.entries(spec.req).map(([k, need]) => ({ stat: k, need, have: r.stats[k] + (k === "SAN" ? 0 : bonus) }));
      const burnable = Object.keys(spec.req).some((k) => k !== "SAN") && r.stats.SAN > this.B.burn_san.cost;
      return { type: "check", id, mode: spec.mode, rows, bonus, fatal: !!spec.fatal, burnable,
               reveal: this.insight >= this.B.insight.intuition_at, stance: r.script.stance,
               pass: this.evalCheck(spec, bonus, false) };
    }
    evalCheck(spec, bonus, burn) {
      const r = this.run, B = this.B.burn_san;
      const res = Object.entries(spec.req).map(([k, need]) => {
        let v = r.stats[k];
        if (k === "SAN") v -= burn ? B.cost : 0;
        else v += bonus + (burn ? B.bonus : 0);
        return v >= need;
      });
      return spec.mode === "any" ? res.some(Boolean) : res.every(Boolean);
    }
    resolveCheck(burn = false) {
      const r = this.run, pc = r.script.pendingCheck, spec = this.checkSpec(pc.id);
      const stance = r.script.stance && spec.stance ? spec.stance[r.script.stance] : null;
      const bonus = (stance ? stance.bonus : 0) + (spec.skillBonus || 0);
      if (stance && stance.san) this.applyFx({ SAN: stance.san }, "抉择");
      const ok = this.evalCheck(spec, bonus, burn);
      if (burn) this.applyFx({ SAN: -this.B.burn_san.cost }, "燃烧理智");
      r.checks[pc.id] = ok;
      r.script.pendingCheck = null;
      if (!spec.final) {
        this.applyFx(ok ? spec.ok : spec.ng, "危机判定");
        if (ok) this.grantInsight(pc.id, spec.insight);
        if (!ok && spec.fatal) r.pendingEnding = "be_death";
      }
      let to = ok ? pc.ok : pc.ng;
      if (spec.final && ok) to = this.trueEndReady() ? "te" : "ne";
      if (spec.anomaly) {
        const v = r.visit; v.outcome = ok ? "resolved" : "failed"; if (ok) r.resolved[v.loc] = true;
        to = `anom_${v.loc}_${ok ? "ok" : "ng"}`;
      }
      this.emit({ type: "check", id: pc.id, ok, burn });
      this.jump(to);
      return { ok };
    }
    trueEndReady() {
      const r = this.run, m = this.meta;
      return Object.values(r.npc).every((n) => n.alive) && this.insight >= this.B.insight.true_end_at &&
             this.D.config.characters.playable.every((g) => m.relics.includes(this.char(g).relic)) &&
             m.keys.includes("key_extra") && m.keys.includes("key_musicbox");
    }

    advance() { /* lines need no state change; kept for symmetry */ }

    finishRun(id) {
      const r = this.run, m = this.meta;
      r.ended = id; r.pendingEnding = null;
      m.endings[id] = (m.endings[id] || 0) + 1;
      if (id === "route_clear") {
        m.runsCompleted++; m.cleared[r.route] = (m.cleared[r.route] || 0) + 1;
        const aid = this.char(r.route).aid;
        if (aid && !m.aids.includes(aid)) m.aids.push(aid);
      }
      if (id === "be_death" || id === "be_collapse") m.deaths++;
      this.emit({ type: "ending", id });
      return { type: "ending", id, info: this.D.config.world.endings[id] };
    }
    endRun() { this.run = null; }

    /* ---------------- persistence ---------------- */
    save() { return JSON.stringify({ meta: this.meta, run: this.run }); }
    load(s) { const o = JSON.parse(s); this.meta = Object.assign(newMeta(), o.meta); this.run = o.run; }

    /* ---------------- intuition (Insight >= 30) ---------------- */
    intuition() {
      const r = this.run;
      if (!r || this.insight < this.B.insight.intuition_at) return null;
      const out = [];
      for (let d = r.day; d <= Math.min(r.day + 1, 6); d++) {
        const spec = this.D.config.checks.checks[`${r.route}_d${d}`];
        if (!spec) continue;
        for (const [k, need] of Object.entries(spec.req)) {
          if (r.stats[k] < need) out.push({ day: d, stat: k, need, have: r.stats[k], fatal: !!spec.fatal });
        }
      }
      return out;
    }
  }

  return { Game, newMeta, STATS, mulberry32 };
});
