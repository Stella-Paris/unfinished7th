#!/usr/bin/env node
/* 构建：config/*.json + story/*.txt  ->  data/gamedata.js (window.GAME_DATA)
 *       并输出 data/voice_lines.json 供语音合成脚本使用。
 * 用法: node dev/build.js [--check]
 *
 * 剧本 DSL：
 *   == scene_id                场景开始
 *   // 注释
 *   @bg id | @bgm id|stop | @sfx id | @show who [left|center|right] | @hide who|all | @cg id|off | @fx shake|flash|glitch|redflash|whiteout
 *   @check id ok=scene ng=scene      危机判定（数值见 config/checks.json）
 *   @final ok=scene ng=scene         第七周目终局判定
 *   @goto scene | @if cond -> scene | @set flag | @eff SAN-5 INT+2 | @insight id n | @ending id | @end
 *   @bond 角色id|here n              增加羁绊（here=本次偶遇的少女）
 *   条件(cond, 用 & 连接, ! 取反): flag:x route:x alive:x dead:x aided:x relic:x key:x cleared:x skill:x check:x growth:1
 *       数值: INT>=40 SAN<30 day>=3 insight>=60 relics>=3 skills>=1 loop>=2 bonds>=2 bondlv_rina>=2 cleared_n>=3
 *   剧情选项的 stance 会自动记为 flag:st_<stance>，后续剧情可以据此呼应
 *   @choice  后接若干行   * 选项文字 -> scene [stance=x] [if=cond]
 *   名字：台词     对白      （……）  内心独白（由当前化身角色发声）      其他行  旁白
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");

const ALIAS = {
  "我": "me", "你": "hero", "莉奈": "rina", "司": "tsukasa", "凛": "rin", "咲": "saki", "云音": "yune", "千夜": "chiyo",
  "栞": "shiori", "遥": "haruka", "美羽": "miu", "小春": "koharu", "柏木": "kashiwagi", "水濑老师": "minase",
  "神代老师": "kamishiro", "广播": "broadcast", "？？？": "unknown",
};
const AVATARS = ["hero", "rina", "tsukasa", "rin", "saki", "yune", "chiyo"];

function hash(s) { return crypto.createHash("md5").update(s).digest("hex").slice(0, 10); }

function parseEff(str) {
  const fx = {};
  for (const m of str.matchAll(/(INT|CON|POW|SAN)([+-]\d+)/g)) fx[m[1]] = +m[2];
  return fx;
}

function parseStory(text, file, scenes, voiceLines, errors) {
  const owner = path.basename(file, ".txt");
  let cur = null, curId = null, lastChoice = null;
  text.split(/\r?\n/).forEach((raw, ln) => {
    const line = raw.trim();
    const where = `${file}:${ln + 1}`;
    if (!line || line.startsWith("//")) return;
    if (line.startsWith("==")) {
      curId = line.slice(2).trim();
      if (scenes[curId]) errors.push(`${where} duplicate scene ${curId}`);
      cur = scenes[curId] = []; cur._owner = owner; lastChoice = null; return;
    }
    if (!cur) { errors.push(`${where} text outside scene`); return; }
    if (line.startsWith("*") && lastChoice) {
      const m = line.match(/^\*\s*(.+?)\s*->\s*(\S+)(.*)$/);
      if (!m) { errors.push(`${where} bad option`); return; }
      const o = { text: m[1], to: m[2] };
      const st = m[3].match(/stance=(\S+)/); if (st) o.stance = st[1];
      const cd = m[3].match(/if=(\S+)/); if (cd) o.cond = cd[1];
      lastChoice.opts.push(o); return;
    }
    lastChoice = null;
    if (line.startsWith("@")) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(" ");
      switch (cmd) {
        case "choice": lastChoice = { t: "choice", opts: [] }; cur.push(lastChoice); break;
        case "check": case "final": {
          const ok = (arg.match(/ok=(\S+)/) || [])[1], ng = (arg.match(/ng=(\S+)/) || [])[1];
          cur.push({ t: cmd, id: cmd === "check" ? rest[0] : "final", ok, ng }); break;
        }
        case "goto": cur.push({ t: "goto", to: rest[0] }); break;
        case "if": { const m = arg.match(/^(.+?)\s*->\s*(\S+)$/); cur.push({ t: "if", cond: m[1], to: m[2] }); break; }
        case "set": cur.push({ t: "flag", name: rest[0] }); break;
        case "eff": cur.push({ t: "fx", fx: parseEff(arg) }); break;
        case "insight": cur.push({ t: "insight", id: rest[0], n: +rest[1] }); break;
        case "bond": cur.push({ t: "bond", g: rest[0], n: +rest[1] }); break;
        case "ending": cur.push({ t: "ending", id: rest[0] }); break;
        case "end": cur.push({ t: "end" }); break;
        case "bg": case "bgm": case "sfx": case "cg": case "hide": case "fx": case "show":
          cur.push({ t: cmd, a: rest[0], b: rest[1] || null }); break;
        default: errors.push(`${where} unknown command @${cmd}`);
      }
      return;
    }
    let who = null, text = line, inner = false;
    const m = line.match(/^([^：:「」（）\s]{1,6})[：:](.+)$/);
    if (m && ALIAS[m[1]]) { who = ALIAS[m[1]]; text = m[2].trim(); }
    else if (/^（.*）$/.test(line)) { who = "me"; inner = true; }
    const cmdObj = { t: "line", who, text };
    if (inner) cmdObj.inner = true;
    if (who) {
      const pm = curId.match(/^(?:(?:pair|grow|view|cev)_)?([a-z]+)_/), sm = curId.match(/_([a-z]+)$/);
      const self = AVATARS.includes(owner) ? owner : pm && AVATARS.includes(pm[1]) ? pm[1] : sm && AVATARS.includes(sm[1]) ? sm[1] : null;
      const speakers = who === "me" ? (self ? [self] : AVATARS) : [who];
      const h = hash(text);
      cmdObj.vk = who === "me" ? `_${h}` : `${who}_${h}`;
      for (const s of speakers) {
        const key = who === "me" ? `${s}_${h}` : cmdObj.vk;
        voiceLines[key] = { speaker: s, text: text.replace(/\{me\}/g, "").replace(/\{me_full\}/g, ""), inner };
      }
    }
    cur.push(cmdObj);
  });
}

function compile({ quiet = false } = {}) {
  const cfgDir = path.join(ROOT, "config");
  const config = {};
  for (const f of fs.readdirSync(cfgDir)) if (f.endsWith(".json")) config[path.basename(f, ".json")] = JSON.parse(fs.readFileSync(path.join(cfgDir, f), "utf8"));
  const scenes = {}, voiceLines = {}, errors = [];
  const storyDir = path.join(ROOT, "story");
  for (const f of fs.readdirSync(storyDir).sort()) if (f.endsWith(".txt")) parseStory(fs.readFileSync(path.join(storyDir, f), "utf8"), f, scenes, voiceLines, errors);

  // scene groups: act_stage_1, act_stage_2 -> act_stage
  const sceneGroups = {};
  for (const id of Object.keys(scenes)) { const m = id.match(/^(.*)_(\d+)$/); if (m) (sceneGroups[m[1]] = sceneGroups[m[1]] || []).push(id); }
  for (const k in sceneGroups) sceneGroups[k].sort();

  // validate references
  const refs = new Set(["te", "ne"]);
  for (const [id, sc] of Object.entries(scenes)) for (const c of sc) {
    const tgts = [c.to, c.ok, c.ng, ...(c.opts || []).map((o) => o.to)].filter(Boolean);
    for (const t of tgts) if (!scenes[t]) errors.push(`scene ${id}: missing target ${t}`);
    if (c.t === "check" && c.id !== "anomaly" && !config.checks.checks[c.id]) errors.push(`scene ${id}: unknown check ${c.id}`);
    if (c.t === "check" && config.checks.checks[c.id]) {
      for (const o of [])
        ;
    }
  }
  // required scenes
  const need = ["collapse", "festival", "te", "ne"];
  for (let d = 1; d <= 7; d++) need.push(config.world.macro[d].scene);
  for (const g of [...config.characters.playable, "hero"]) for (let d = 1; d <= 7; d++) need.push(`${g}_d${d}`);
  for (const g of config.characters.playable) need.push("rumor_" + g, "deliver_" + g);
  for (const c of config.explore.clues) need.push(c.id);
  need.push("anom_try", "anom_skip", "anom_ok", "anom_ng");
  for (const [k, l] of Object.entries(config.explore.locations)) if (l.anomaly) need.push(...l.anomaly, `anom_${k}_ok`, `anom_${k}_ng`);
  for (const g of config.characters.playable) if (!sceneGroups["enc_" + g]) errors.push(`no encounter scenes for ${g}`);
  for (const l in config.explore.ambient) for (const a of config.explore.ambient[l]) need.push(a.id);
  const missing = need.filter((x) => !scenes[x]);

  // 资源与指令检查
  const has = (dir, id, exts) => exts.some((e) => fs.existsSync(path.join(ROOT, "assets", dir, id + e)));
  const chars = config.characters.chars;
  for (const [id, sc] of Object.entries(scenes)) for (const c of sc) {
    if (c.t === "bg" && !has("bg", c.a, [".webp", ".png", ".jpg"])) errors.push(`scene ${id}: missing bg ${c.a}`);
    if (c.t === "cg" && c.a !== "off" && !has("cg", c.a, [".webp", ".png", ".jpg"])) errors.push(`scene ${id}: missing cg ${c.a}`);
    if (c.t === "bgm" && c.a !== "stop" && !has("audio/bgm", c.a, [".ogg", ".mp3"])) errors.push(`scene ${id}: missing bgm ${c.a}`);
    if (c.t === "sfx" && !has("audio/sfx", c.a, [".ogg", ".mp3", ".wav"])) errors.push(`scene ${id}: missing sfx ${c.a}`);
    if (c.t === "show" && !chars[c.a]) errors.push(`scene ${id}: unknown sprite ${c.a}`);
    if (c.t === "bond" && c.g !== "here" && !config.characters.playable.includes(c.g)) errors.push(`scene ${id}: bad @bond ${c.g}`);
    if (c.t === "bond" && !(c.n > 0)) errors.push(`scene ${id}: bad @bond amount`);
  }
  for (const g of config.characters.playable) for (const lv of [2, 3]) if (!scenes[`bond_${g}_${lv}`]) errors.push(`missing bond_${g}_${lv}`);

  // voice manifest
  const voice = {};
  const vdir = path.join(ROOT, "assets", "audio", "voice");
  if (fs.existsSync(vdir)) for (const f of fs.readdirSync(vdir)) { const k = f.replace(/\.(mp3|ogg|wav)$/, ""); if (voiceLines[k]) voice[k] = "assets/audio/voice/" + f; }

  for (const sc of Object.values(scenes)) delete sc._owner;
  const data = { config, scenes, sceneGroups, voice, builtAt: new Date().toISOString() };
  if (!quiet) {
    const chars = Object.values(scenes).flat().filter((c) => c.t === "line").reduce((n, c) => n + c.text.length, 0);
    console.log(`scenes=${Object.keys(scenes).length} lines=${Object.values(scenes).flat().filter((c) => c.t === "line").length} chars=${chars} voiceLines=${Object.keys(voiceLines).length} voiced=${Object.keys(voice).length}`);
    if (errors.length) console.log("ERRORS:\n  " + errors.join("\n  "));
    if (missing.length) console.log(`MISSING scenes (${missing.length}): ` + missing.join(", "));
  }
  return { data, voiceLines, errors, missing };
}

if (require.main === module) {
  const { data, voiceLines, errors } = compile();
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "gamedata.js"), "/* generated by dev/build.js — edit config/ and story/ instead */\nwindow.GAME_DATA = " + JSON.stringify(data) + ";\n");
  fs.writeFileSync(path.join(ROOT, "data", "voice_lines.json"), JSON.stringify(voiceLines, null, 0));
  if (errors.length && process.argv.includes("--check")) process.exit(1);
}
module.exports = { compile };
