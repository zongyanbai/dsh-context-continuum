# 检索口径实测报告（离线补做）

> 对象：真实会话 `session-<REDACTED>`（9 代压缩、9030 个事件、日志压缩包 8.3 MB）
> 问题：**"我按锚点取回原文"和"现在的历史检索"到底差多少？**
> 方法：只读原始日志，三条路径对同一批事实各算召回与代价。脚本见文末。
> 说明：本报告不复用 `ab-experiment3.mjs` 的 `B+锚点 407/407` 那一格（该格是恒真式，见第 4 节）。

---

## 1. 先定口径（不能靠猜）

宿主 `@deepseek-ai/dsh-session-query` 的 README（`types/dsh-session-query/package/README.zh.md`）给出：

- `readSurface` = **完整的当前模型表层**；`foldSurface` 把事件分为 `current` / `shadowed` / `log-only`。
- `readSession` / `filterEvents` **回放并校验整份逻辑日志**（"非常大的历史每次调用都要付出完整检查"），`text` 子句是"对所提取语义文本的字面、不区分大小写、空白灵活的扫描"。
- 该包是**应用代码的可信基础设施**，并且"模型工具或 UI 必须限制调用方可检查的会话"。

实测校验：本机 **不存在** `dsh-tool-session-query`（模型侧消费者面），desktop profile 也未装配任何检索 bundle。
→ **"现在的历史检索"对模型而言只有表层这一条路。**

### 表层类型的自洽反推

只有会出现在表层的类型才可能被替换，故"曾被 shadow 的类型"即模型可见类型。实测得到 5 种：

`user/message`、`assistant/message`、`tool/result`、`developer/message`、`system/message`

**`tool/call` 1537 个事件从未被 shadow** → 它属于 `log-only`，不在表层。若把它算作可见（v1 犯过的错），会把大量重复载荷误记成"模型看得见"。

| 量 | 值 |
|---|---|
| 事件总数 / 其中带 seq | 9031 / 9030 |
| 压缩代次 | 9（末代覆盖到 seq 5761，其后 3268 个 seq 为当前表层） |
| 被 shadow 的 seq | 2232（24.7%），全部是可见类型 |
| **表层事件 / 代价** | **1074 个 / 1,927,752 tok** |
| 整份逻辑日志代价 | 7,719,692 tok |

---

## 2. 基准事实集

复刻 `AB实测报告.md` 的抽取规则（路径 / 审计编号 / 百分比 / 计数），取"seq ≤ 848 且**此后全史不再出现**"者。

- 本报告得到 **400 条**；原报告为 407 条，差异 1.7%，源于本次先做反斜杠归一化（原脚本存在 JSON 转义残留，其 v3 笔记已记录该坑）。
- 独立账本另测：`deliverables/presented` + 写文件工具调用，去重 **234 条产物路径**。

---

## 3. 三路径实测结果

| 路径 | 召回 | 代价 | 模型侧可用 |
|---|---|---|---|
| **最终摘要 A**（现在滚动压缩的产物） | **0/400 = 0.0%** | 20,029 字 ≈ 7,703 tok | 是 |
| **P1 表层**（宿主 `foldSurface` 口径，1074 事件） | **301/400 = 75.3%** | 常驻 **1,927,752 tok** | 是（唯一） |
| **P2 内置基础设施口径**（`readSession`/`filterEvents` + `text` 扫描） | 400/400（**构造性成立**） | **7,719,692 tok / 次调用** | **否**（本机无此工具） |
| **P3 锚点口径**（索引定位 + 按 seq 按需取回） | 表层看不见的 **99/99 可精确定位** | 索引 ≈ **3,585 tok**（9 代，插件当前格式）+ 单条中位 **332 tok** | 需启用插件 |

### 关键差别

1. **现在模型只有表层**，而表层已丢掉 **99/400 = 24.8%** 的早期专属细节。
2. 丢的是**路径类**为主：路径 53 条中 **47 条看不见（88.7%）**；百分比 2/2；计数 345 条中 50 条（14.5%）。
3. 基础设施口径**理论上能扫到被压缩原文**（因为 `readSession` 回放整份日志），但代价是 **7.72M tok/次**，且模型侧没有入口。
4. 锚点：**99/99 每条都能落到具体 seq**。取回一条 ≈ 718 tok（386 索引分摊 + 332 中位切片），比整份回放省 **10,747 倍**；99 条全取回 238,731 tok，省 **32.3 倍**。

> **更正版（2026-10-07）**：上表里"索引 386 tok"是早期用 log-only 归属（按 shadowedSeqs 集合）测的，**漏掉了大半产物**——同一 bug 也让早期 A/B 报告里 `B+锚点 407/407=100%` 看似可保留早期事实（实际是恒真式）。修正归属为按**区间**归集后，插件当前格式的索引为 **3,585 tok**（9 代 9 条 / 表层），仍比真实摘要（7,703 tok）省约 54%、比整份回放（7,719,692 tok）省约 2,150×。详见 [`facet模板AB实测.md`](facet模板AB实测.md) §4 与本报告 §8.5。

---

## 4. 同时纠正三处此前的说法

| 原说法 | 判定 | 依据 |
|---|---|---|
| "B+锚点检索 407/407 = 100%" 是测量 | **[假]** | `ab-experiment3.mjs` 第 89–93 行先从 `earlyText` 抽事实、再用 `earlyText.includes` 验证，恒真；第 112 行的 `100%` 还是写死的字符串。它只证明"原文仍在 append-only 日志里"。 |
| "A 的 0/407 说明早期事实从模型视野里全丢了" | **[假]** | 0/400 只对**摘要文本**成立；**表层仍保留 301/400 = 75.3%**——早期区间 331 个可见类型事件里有 8 个未被 shadow，其中大 `tool/result` 承载了大量事实。 |
| "产物路径会随压缩丢失" | **[非真非假]** | 实测 **234/234 全部仍在表层**（会话尾部很长，路径被反复重提）。丢失集中在"早期专属细节"，不在产物路径。 |

### 见证（可复验）

- 事实 `<USER_HOME>\AppData\Local\Temp\dsh-spill-Qd6rFL`：出现于 **seq 93（未 shadow，仍在表层）** 与 **seq 840（已 shadow）**。
- 事实 `<USER_HOME>\<AUDIT_TOOL>\report1.txt`：出现于 seq 127,147,148,149,153,154,155,846，其中 127,147,153,155,846 已 shadow，**148/149/154 仍在表层**。
- 早期区间构成：`tool/result` 155 shadow / 5 未 shadow；`assistant/message` 131/0；`user/message` 35/0；`system/message` 1/3；`developer/message` 1/0。

---

## 5. 尺子修正记录（本次迭代）

1. **v1 错**：把"路径在未 shadow 事件里出现过吗"当表层召回 → 恒 100%，没有区分度（路径会被后续活动重提）。
2. **v2 错**：由此得出"表层什么都没丢（0 条丢失）"，并把它当成结论 → 事实集合选错（用产物账本当基准）。
3. **v3 正**：以宿主 `foldSurface` 语义定义表层，排除 `log-only` 的 `tool/call`，再对"此后全史不再出现"的事实集测 → 75.3% 可见 / 24.8% 不可见。
4. 反斜杠归一化（`\\` → `\`）：B 组 `0/407` 经严格匹配、归一化匹配、末段文件名匹配三把尺子复核**全为 0**，不是转义假零。

---

## 6. 限制（不可外推的部分）

- n=1 会话；token 用原报告口径 字/2.6 估算。
- 事实集为"路径 / 编号 / 百分比 / 计数"的**代理口径**，非通用信息保留率。
- P1 的"表层"= 宿主 `foldSurface` 意义上的未 shadow 可见事件（1,927,752 tok）；模型上下文窗口若小于此，实际可见更少，故 75.3% 是**上界**。
- P2 的 400/400 与 P3 的 99/99 均含**构造性成分**（事实来自日志本身；可寻址性由 seq 存在保证）。真正被测量的是：表层可见率 75.3%、三类代价、以及"模型侧无 P2 入口"。
- 端到端取回**已测并已修复**（见第 8 节）：真实编译产物 + 真实日志 + 宿主真实签名的 `readSession` 桩，取回率 **99/99 = 100%**（修复前 76.8%，缺陷是文本投影丢工具调用参数）。
- 仍未做：**真实宿主内**由模型亲自调用工具（需要在 desktop profile 重新接线并重启）。

---

## 7. 复现命令

```powershell
$log = "$env:USERPROFILE\.dsh\sessions\--<USER_HOME>--\session-<REDACTED>\session.v4.jsonl.zstd"
node "<USER_HOME>\<REPO>\ab-experiment3.mjs"                $log <USER_HOME>\<REPO>\.tmp\ab-v3-rerun.md
node "<USER_HOME>\<REPO>\.tmp\verify-ab-ruler.mjs"          $log
node "<USER_HOME>\<REPO>\.tmp\verify-b-ruler.mjs"           $log
node "<USER_HOME>\<REPO>\.tmp\offline-retrieval-ab2.mjs"    $log
node "<USER_HOME>\<REPO>\.tmp\ab-facts-final2.mjs"          $log
node "<USER_HOME>\<REPO>\.tmp\witness-facts.mjs"            $log
```

全部只读原始日志，不写任何系统位置。

---

## 8. 端到端取回实测（真实编译产物 × 真实日志）

**被测对象**：`plugin/lib/tools.js`（**编译产物**，不是源码重写）。
**宿主边界**：只把 `ctx.sessionQuery` 换成桩；桩的签名逐字对齐宿主真实签名
`readSession(sessionId): Promise<{session, inheritedEventCount, events: SessionEvent[]}>`（`plugin/node_modules/@deepseek-ai/dsh-session-query/lib/types/index.d.ts:74`）。
**数据**：真实会话 8.3 MB append-only 日志。

### 8.1 通过的部分

| 检查 | 结果 |
|---|---|
| `context_anchors` 从真实日志重建账本 | ✅ 报"共 10 次，累计压掉约 903676 tokens" |
| 每代事件数与日志逐代一致 | ✅ 243/266/300/244/271/200/262/250/196（合计 2232） |
| 账本次数（10）的诚实性 | ✅ `compaction/start` 10 / `summary` 9 / `end` 10（**1 个带 error**）——第 10 次压缩失败，账本如实计入 |
| `context_read` 按 seq 取回 | ✅ 请求 69 个被 shadow 的 seq → 69 段全部有文本 |
| 逐字性（非摘要） | ✅ 抽查 12/12 返回正文为原事件文本前缀；摘要对这些事实命中 0/400 |
| `compactionId` 入口 | ✅ T1 返回 243 个事件，首段为 seq 8 的 `user/message` 原文 |
| 阴性对照 N1：无 `sessionQuery` | ✅ 报"会话检索面未注入（ctx.sessionQuery 不可用）"，不假装成功 |
| 阴性对照 N2：只给未被 shadow 的事件 | ✅ 6/99 = 6.1%（≠ 100%）——证明取回率不是恒真 |
| 阴性对照 N3：不存在的 seq | ✅ 报"未找到 seq 为 999999 的事件" |

### 8.2 首轮暴露的缺陷：取回率 76.8%（已修复）

- 寻址能力 **99/99**：每条表层看不见的事实都至少有一个**被 shadow** 的出现位置（0 条只落在 log-only）。
- 首轮真实取回只有 **76/99 = 76.8%**；缺口全部落在 `assistant/message` 的**工具调用参数**上。

**根因（源码定位，`assistant/message` 的实际形状）**：事实的承载路径是
`$.data.message.content[N].arguments`，该块 `type` 为 **`tool-call`**，`arguments` 是**字符串**。
而 `blocksToText`（`anchors.ts`）对非文本块只压入占位符 `[${type}]`、**不含块内容**；
`extractEventText`（`trace.ts`）覆盖 `data.text` / `data.content` / `data.message.content` /
`data.result.content` / `data.summary`，**完全不读 `data.arguments`**。

**修复**（三个函数，`plugin/src/anchors.ts` + `plugin/src/trace.ts`）：

1. `blocksToText(blocks, { includeBlockPayload })` 新增选项：默认 `false`（索引/摘要路径保持紧凑占位，长度预算不受影响），原文取回路径传 `true`。
2. 新增 `renderValue()`：按**值原样**展开块载荷，**字符串不加任何转义层**——`arguments` 本身已是 JSON 文本，再套 `JSON.stringify` 会变成四反斜杠，那就不是逐字原文（这正是中间一版只到 80.8% 的原因）。
3. `extractEventText` 追加 `data.arguments` / `data.input` 候选，并支持参数为对象/数组的形态。

**复验结果（同一把尺子，两侧反斜杠归一化）**：

| | 取回率 | 载荷（69 个事件） |
|---|---|---|
| 修复前 | 76/99 = **76.8%** | 110,838 字 ≈ 42,630 tok |
| **修复后（真实 `lib/tools.js`）** | **99/99 = 100.0%** | 212,888 字 ≈ 81,880 tok |

代价如实记录：逐字展开工具参数让载荷**约翻倍**；这是"要完整原文"必然的代价，且只发生在显式调用 `context_read` 时，索引那条路径分文不涨。

工程验证：`tsc -p tsconfig.json` 退出码 0；`vitest run` **93 个测试全过**（新增 4 个回归测试钉住"默认紧凑 / 取回展开 / 工具参数可读"）。

### 8.3 与离线报告的数字对照

| 量 | 离线报告 | 端到端实测 |
|---|---|---|
| 表层看不见的事实 | 99/400 | 99/400（同一集合） |
| 锚点可寻址 | 99/99（口径偏宽，含 log-only 出现位置） | **99/99**（收紧为"至少一个被 shadow 位置"，结论不变） |
| 逐字取回 | 未测 | **99/99 = 100%**（修复后） |
| 代价 | 估算"中位 332 tok/条" | 真实载荷 **81,880 tok / 69 个事件**（工具返回整段事件文本，非仅事实所在行） |

### 8.4 我自己在这轮犯的两个尺子错误（记录备查）

1. 拿**归一化**后的事实去**原始输出**里找，而工具参数里的路径是双重转义形态 → 把已取回的事实误判为未取回（真实取回被低估为 80.8%）。
2. 中间一版修复用 `JSON.stringify` 包块载荷，等于**再加一层转义**，同样破坏逐字比对（只到 80.8%）。

两次都是"尺子/实现里的转义层"问题，不是机制问题；修正后前后对照才干净：**76.8% → 100%**。

### 8.5 复现

```powershell
node "<USER_HOME>\<REPO>\.tmp\e2e-real-log.mjs"  $log   # A1/A2/A3 + 三组阴性对照
node "<USER_HOME>\<REPO>\.tmp\e2e-real-log2.mjs" $log   # 寻址口径收紧 + 失败归因
node "<USER_HOME>\<REPO>\.tmp\e2e-real-log3.mjs" $log   # 同一把尺子下的前后对照（权威数字）
node "<USER_HOME>\<REPO>\.tmp\diag-field-path.mjs" $log # 事实的准确承载路径

# 工程侧（改动后）
cd <USER_HOME>\<REPO>\plugin
node node_modules\typescript\bin\tsc -p tsconfig.json      # 类型检查
node node_modules\vitest\vitest.mjs run                    # 93 个测试
node node_modules\typescript\bin\tsc -p tsconfig.build.json # 重新生成 lib/
```

