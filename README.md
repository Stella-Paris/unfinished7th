# 未完的第七日 · The Unfinished 7th Day

基于《设计_完善版.docx》实现的网页剧情向养成游戏（日系超能力学园 / 多周目时空轮回养成 / 悬疑 ADV）。

## 运行

纯静态网页，无需服务器：**直接用浏览器打开 `index.html`**（推荐 Chrome / Edge）。
也可以 `python3 -m http.server` 后访问 `http://localhost:8000/`。

修改了 `config/` 或 `story/` 之后，需要重新构建一次数据：

```bash
node dev/build.js          # → data/gamedata.js（同时检查剧本引用错误、缺失场景）
```

## 目录

```
unfinished7th/
├─ index.html  css/  js/
│   ├─ engine.js     核心规则引擎（纯逻辑，浏览器与 Node 共用）
│   ├─ bot.js        决策树模拟玩家（测试面板与模拟器共用）
│   ├─ ui.js         界面 / 演出 / 存档
│   ├─ audio.js      BGM 交叉淡入淡出、音效、语音接口
│   └─ debug.js      内部测试接口
├─ config/        ★ 配置表（所有数值都在这里）
├─ story/         ★ 剧本文案（DSL，见 dev/build.js 顶部说明）
├─ data/          构建产物（gamedata.js、voice_lines.json）
├─ assets/        ★ 美术 / 音频资源（独立文件夹）
│   ├─ characters/  主角团立绘（原画抠图）
│   ├─ npc/         NPC 立绘（Krea 2 参考图生成）
│   ├─ bg/  cg/     场景背景、事件 CG（Krea 2 生成）
│   ├─ ui/items/    道具图标
│   ├─ audio/bgm, sfx, voice
│   └─ CREDITS.md   素材来源与许可
└─ dev/
    ├─ build.js       构建
    ├─ sim.js         大规模模拟
    ├─ tune.js        自动调参
    └─ sim_report.md  最新模拟报告
```

## 配置表（config/）

| 文件 | 内容 |
|---|---|
| `balance.json` | 全局数值：行动点、SAN 分级/晨间恢复/每日宏观衰减、Insight 阈值(30/60/100)、课程成长、燃烧理智、NPC 存活率、终局判定、第七周目解锁条件 |
| `characters.json` | 角色：初始属性、课程成长倍率、关联文化祭项目、信物/干涉道具 |
| `checks.json` | 6 条角色线 + 第七周目全部危机判定：需求(且/或)、剧情抉择修正、成功/失败效果、首次成功 Insight |
| `actions.json` | 上午课程、下午文化祭项目(效果、羁绊技能) |
| `explore.json` | 黄昏地点、关键线索(出现日、条件、Insight)、日常小事件 |
| `items.json` | 灵魂信物、因果干涉道具(交付地点/期限)、核心解密道具 |
| `world.json` | 全校宏观事件轴、结局表、NPC 第二日传闻 |
| `voices.json` | 每个角色的 TTS 音色与语速 |

## 系统实现要点

- **意识化身**：前 6 周目任选少女第一人称体验；化身少女死亡 / SAN<20 → BE 并回到观测空间。
- **3×3 行动点**：上午课程(INT/CON/POW) → 下午文化祭排练(每项每日限 1 次，累计 4 次解锁羁绊技能) → 黄昏勘察 → 夜幕危机判定。
- **黄昏特训**（`explore.json` 的 `train`、`balance.json` 的 `dusk_train`）：每个地点练对应属性（图书馆 INT、变电站/地下 POW、操场 CON……），收益高于日常事件但扣 SAN；温室、医务室为疗养型（小幅成长 + 回复 SAN）。
  - **分区**：每个地点 3 个分区（如图书馆 一楼/二楼/三楼），各有独立背景；跨周目累计，每次探索开启下一区，全部开启后随机；越深的分区收益越高。
  - **地点异常**：随机出现（`anomaly_chance`），可选择处理（判定该地点主属性，需求随天数上升）或绕开。处理成功 → 本周目该地点特训 SAN 消耗 ×`resolved_mult`；失败或绕开 → 本次消耗 ×`unresolved_mult`。
  - **偶遇**：按 `explore.json → encounters` 的「少女 × 地点」概率表判定，偶遇时本次 SAN 消耗 ×`encounter_mult`。已故的少女不会出现。
  - 优先级：关键线索 ! ＞ 异常 ＞ 偶遇 ＞ 日常小事件；无论哪种都会在剧情后结算特训。
- **AUTO 模式**：已读过的句子会自动快进（已读记录跨周目保存在存档里），遇到选项/判定仍会停下。
- **SAN**：40–99 稳定；20–39 紊乱(选项乱码、红雾、18% 概率误选)；<20 崩溃。
- **Insight 防刷**：所有 Insight 来源都是全局唯一标记（`meta.insightFlags`），重复触发、读档都不会再加。
  阶段被动：30 直觉警示（判定数值可见+次日短板预警）、60 因果转译（可跨周目交付干涉道具）、100 真结局门槛。
- **NPC 50% 存活**：未操控的少女在 Day5 夜结算；交付对应干涉道具 → 100%。死亡会关闭其关联文化祭项目并扣 SAN。
- **第七周目**：完成 6 个周目后解锁，主角本尊出场。17:50 终局判定（每位存活同伴降低需求，羁绊技能加成）。
  达成 6 人全员存活 + Insight 100 + 6 信物 + 破损的号外报纸 + 锈蚀的发条八音盒 → 真结局，否则普通结局。

## 内部测试接口

- 游戏内按 **F9** 或 **`** 打开测试面板，或 URL 加 `?debug=1`。可改属性/Insight、发放道具、解锁第七周目、跳转任意日程/场景、切换 NPC 生死、让机器人接管当前周目、在独立副本中批量模拟、导入导出存档。
- 控制台 API：`U7.test.setStat('POW', 80)`、`U7.test.jump(5, 'dusk')`、`U7.test.setInsight(100)`、`U7.test.simulate('casual', 200)`、`U7.test.autoplayCurrent('planner')`。

## 模拟与调参

```bash
node dev/sim.js --n 400 --campaigns 150            # 四种玩家模型：blind / planner / casual / random
node dev/tune.js --iters 4 --n 200 --write         # 坐标搜索调参并写回 config，输出 dev/sim_report.md
```

决策树玩家：
- **blind（盲玩，调参主目标）**：不读配置表，只用界面上看得到的信息——属性、卡片上的效果/SAN消耗、金色「!」、Insight≥30 后的判定数值与直觉警示；会记住自己见过的判定（数值不可见时按失败时的属性估计）；剧情抉择凭直觉随机。
- **planner**：按后续危机的属性缺口/成长倍率选课；SAN 不足时去休息/选回复类活动；优先新线索与道具交付；选择有利抉择；必要时燃烧理智。
- **casual**：偏好角色擅长属性、部分随机、不总是选最优抉择。
- **random**：完全随机。

调参目标与当前结果见 `dev/sim_report.md`。

## 资源再生成（../tools/）

```bash
# 美术（需先启动 Krea 2 服务：AI_toolkit/krea2/start.sh）。已有文件会跳过；删除对应文件即可重画
tools/.venv/bin/python tools/gen_assets.py [id过滤]
# 语音（Kokoro-82M-v1.1-zh，默认用 cuda:1）
node dev/build.js && tools/tts/.venv/bin/python tools/tts/gen_voice.py
```

Krea 2 服务新增了 `/img2img` 接口（参考图 + 提示词，SDEdit 方式），原 `/generate` 保持不变；原文件备份为 `server.py.bak`。
