# @local/dsh-context-continuum（上下文连续体）

把三件事合成一个 DSH 压缩后端插件：

1. **满窗自动续接** —— 接近满窗时自动压缩，provider 报 `CONTEXT_WINDOW_EXCEEDED` 时强制压缩并自动重试；
2. **压缩成"会话索引"** —— 覆写官方唯一的摘要钩子，产出一份**不可变、只追加**的条目索引（每条 = 标题 / 状态 / 未决 + 产物），而不是让模型每代重写整段叙事；
3. **回原始对话定位** —— 按锚点取回被压缩掉的**逐字原文**（原文从未被删除，只是被遮蔽）。

## 为什么不是"让模型写摘要"（A/B 实测结论）

在同一个真实会话上做过 A/B（`AB实测报告.md`）：

| 指标 | 官方滚动摘要 | 会话索引（本插件） |
|---|---|---|
| 早期字面事实存活率 | **0 / 407** | 条目逐字继承，不再被重写 |
| 摘要长度轨迹 | 13,762 → 20,029 字 | 154 → 3,079 字（≈110 字/代） |
| 官方叙事结构泄漏进摘要 | 每代都有 | **0 / 27 代**（装配器强制丢弃叙述正文） |

机制根源（读日志得到，不是猜）：官方引擎的替换区间**起点恰好是上一份摘要的 seq**（9/9 次），
即每代都在**重写旧摘要**——早期内容被反复磨平。而原文在 append-only 日志里一条不少。

所以本插件的做法是：**让模型只写一个新条目**，由装配器把旧条目**逐字搬运**过来。
官方虽会重压整个区间，但只要旧条目文本被原样搬运，早期内容就不再被改写。

序号 `T<n>` 与第 n 个成功压缩事务一一对应，锚点由 `context_anchors` 给出
（`SummarizationInput` 里**没有 seq**，所以 seq 不写进条目，由工具侧对齐）。

## 三层接线（缺一层就不生效）

| 层 | 文件 | 作用 |
|---|---|---|
| ① bundle patch | `cordis.patch.yml` | 置灰顶层 `compaction-basic`，`insert` 本插件行 + 压缩参数 |
| ② profile 用户层 | `preset-continuum.patch.yml`（追加进 profile 的 `cordis.patch.yml`） | 新增 `preset-continuum`：`standard` 的确定性变换，只把压缩组里的后端换成本插件 |
| ③ 依赖与解析 | profile 的 `package.json` + `node_modules/@local/dsh-context-continuum` | 让包可解析（本机 pnpm 不在 PATH，用 junction） |

**为什么 preset 不能写进 bundle patch**（踩过）：bundle patch 会被**任何**装了本插件的 profile 应用，
而 preset 文档引用了 `dsh-tool-ralph`、`dsh-agent-preset` 等来自 web-app/实验 bundle 的行；
在只有 base+headless 的 profile（如 `continuum-test`）里，那些行解析不到。

### 实测的 patch DSL 语义（三条，都有证据）

| 现象 | 证据 | 结论 |
|---|---|---|
| 按 `id` 能命中 preset 组内**嵌套**行 | 补丁被处理并报错，说明匹配到了 | 定位没问题 |
| **不能改行的 `name`** | `patch: name mismatch for "compaction-basic" (expected "@deepseek-ai/dsh-compaction-basic", got "@local/dsh-context-continuum"), skipping` | 换后端**不能靠改名** |
| `disabled: true` 只影响顶层行 | 加补丁前后，三个 preset 内的 `compaction-basic` 都是 enabled（只有顶层 L337 是 disabled，且那是 web-app bundle 干的） | preset 作用域必须**自己给一行** |

可用的办法就是官方 shipped preset 自己注释里写的那个：
> Edits saved from the Web editor override this row's `config.plugins` by id from the profile patch.

即往 profile patch 里写一个 `@deepseek-ai/dsh-agent-preset` 行（`config.plugins` 里放本插件）。
原 README 提的"用 `agent-presets` 的 `roots` 注册"**不是**必需路径。

## 生效与回退

接线已落到 desktop profile（当前 GUI 用的就是它），但**需要重启应用**才生效：

1. 重启 DeepSeek Harness；
2. 会话里选「continuum」这个 agent preset（或在 profile patch 里把
   `agent-preset-registry.selectedDefault` 改成 `continuum`）——**没有替你改默认值**，避免擅自动你的会话。

回退（两步，都已备份）：

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json.bak_pre_continuum" "$p\package.json" -Force
Copy-Item "$p\cordis.patch.yml.bak_pre_continuum" "$p\cordis.patch.yml" -Force
cmd /c rmdir "$p\node_modules\@local\dsh-context-continuum"   # 只删 junction，不碰源目录
```

> 删 junction 用 `cmd /c rmdir`，不要用 `Remove-Item -Recurse`（后者在旧版 PowerShell 上会删到目标内容）。

## 可复验的验证

```powershell
cd <USER_HOME>\<REPO>\plugin
npm.cmd test          # 89 项单测 / 10 个文件
npm.cmd run typecheck # 对真实 @deepseek-ai/dsh-*@0.2.0-rc.2 声明做类型检查
npm.cmd run build     # 产出 lib/（7 个 .js）
```

`tsconfig.json` 是 `noEmit: true`（只做类型检查），真正的构建是 `tsconfig.build.json`。
**先删 `lib/` 再构建**——否则旧产物会冒充"构建成功"（踩过：残留的 `lib/digest.js` 让一次验证变成假阳性）。

其中几项是"能编译"之外的硬证据：

- `tests/mount.spec.ts`：用替身服务**在进程内真实挂载**，断言 `ctx.get('compaction')` 就是本插件实例、工具注册成功、缺 `tools` 不崩、配置被官方校验器接受。
- `tests/bundle.spec.ts`：真解析 `cordis.patch.yml`（剥掉 DSH 的 `!!js` 扩展标签后再解析——js-yaml 5.4.2 已不导出 `Type`/`DEFAULT_SCHEMA`），断言置灰了 `compaction-basic`、insert 行指向本包、配置键都在官方 Config 允许集合内（patch 写错不会报错，只会静默不生效）。
- `tests/archive.spec.ts`：**归档后序号必须继续递增**（这是归档最容易写错的地方：用"可见条目数 + 1"会在归档后让序号重复）、表层封顶、归档行不重复累积。
- `tests/presented.spec.ts`：权威产物账本抽取；"读不到"必须返回 `undefined` 而非空数组（不能把读不到伪装成没有）。

### 真实数据重放（`(.tmp/replay-index.mjs)`）

拿真实会话 `session-<REDACTED>…` 的 **39 代真实摘要**按新规则重跑：

| 断言 | 结果 |
|---|---|
| 序号严格递增且连续 T1..T39 | 通过 |
| 表层条目封顶 24 | 通过（第 25 代开始出现归档 `T1…T1`） |
| 长度轨迹 | 前 1/3 代平均 505 字 → 后 1/3 代平均 **2,822** 字（不归档同段 **3,752** 字） |
| 第 28 代（真实引擎在此拒绝 `760 >= 740`） | 新规则 **2,563** 字 / 24 条；不归档 4,214 字 / 40 条 |

即归档把"线性增长"变成"封顶平台"，这正是解掉那个硬上限的机制。

## 超量归档（需求(b)）与它的取舍——**请读这一段**

条目只增不减会让索引最终长到**比被压内容还大**，此时官方引擎主动拒绝压缩
（实测：`summary is not smaller than the shadowed content (760 >= 740)`，整个压缩事务失败）。

所以表层只保留最新 `MAX_ENTRIES_IN_SURFACE = 24` 条正文，更早的压成**一行归档指针**
（`- 已归档：T1…T15（共 15 条…）`）。归档区间恒为前缀，因为序号从 1 连续递增。

**代价（如实写明）**：被归档条目的**逐字正文（含标题）离开表层**。它们没有丢——
原文仍在 append-only 日志里，且每个 `T<n>` 都能对上一个锚点，可用
`context_anchors` 查锚点、`context_read` 按 seq 逐字取回。

这与"记住每一次对话的每个标题"的原始设想**有张力**：表层给不了 24 条以外的标题。
更贴合设想的做法是把「每条的标题 + 该条区间的产物」做成 **`context_anchors` 的输出**
（它本来就逐事件读日志，加标题与产物是确定性的、不占表层），**尚未实现**。

## 代码结构

| 文件 | 职责 |
|---|---|
| `src/engine.ts` | 压缩后端本体：继承官方引擎，只覆写 `summarize()`；构造时经 `ctx.inject(['tools'])` 注册工具 |
| `src/indexlog.ts` | 需求(b)：索引模板与指导文本、旧条目逐字继承、强制丢弃叙述正文、**超量归档** |
| `src/artifacts.ts` | 需求(a)：权威产物账本（`deliverables/presented`）+ 消息面兜底抽取 |
| `src/anchors.ts` | 需求(c)：从日志按 `compactionId` 归并出锚点账本（`shadowedSeqs` / token / provider / model / 失败原因） |
| `src/trace.ts` | 需求(c)：按锚点 seq 取回逐字原文；首选已核实的 `readSession(sessionId)` 形状 |
| `src/tools.ts` | `context_anchors`（看被压了什么）、`context_read`（取回逐字原文）、`context_compact`（手动就地压缩） |

## 已知缺陷（不粉饰）

1. **标题质量**：真实宿主上 27 代里有 13 条的标题字面是 `Primary Request and Intent`——
   因为宿主会在本插件的指导消息**之后**再追加自己的压缩指令，模型于是返回官方叙事结构。
   装配器已经把叙述正文丢干净（0 泄漏），但**标题**仍取自模型第一行，因此会被带偏。
2. **`shadowedTokenCount` 不可信**：日志里 4–7 个事件被标成 ~57.4 万 token、62 次压缩累计 1,155 万——
   它像是把整个前缀（含 system 头与工具 schema）都算进去了。**不要**把它当真实节省量引用。
3. **产物账本的实时读通尚未在活宿主上观察到**：单测 + 真实日志扫描（10 个会话中 3 个含
   `deliverables/presented`，21 个事件解析出 33 条产物路径）都通过，但"压缩时经 `sessionQuery`
   真的读到账本"这一步只在离线验证过；从 agent 上取会话 id 的路径同样未在活宿主复验。
4. **desktop 的合成只能在副本上离线验证**：CLI 拒绝 `--profile desktop --dump-config`
   （Electron 独占）。做法是复制一个 `desktop-verify`（`node_modules` 走 junction），
   在它上面 dump，再断言两份 `package.json` / `cordis.patch.yml` **逐字节相同**，把结论传递过去。
5. `context_compact` 在**回合进行中**会被官方引擎以 `busy` 拒绝（官方语义，非缺陷），工具已把 busy 转成明确提示。

## 实测学到的硬约束（写在此处避免重踩）

| 配置 / 情形 | 后果 |
|---|---|
| `headroomTokens: 0` | 官方断言直接拒：`maxTokens … must be a positive integer`，**整个条目不激活**，`command-compact` 随后卡在 `pending (waiting for service: compaction)` |
| `maxTokens` 过小 | 摘要被截断，引擎报 `summarization truncated at the token cap (incomplete checkpoint)` 并**拒绝安装** |
| `retainRatio >= thresholdRatio` | 没有可压区间，`compactIfNeeded` 返回 `null` |
| 摘要不比原文小 | 引擎主动拒绝：`summary is not smaller than the shadowed content` → 见上面的归档设计 |

## 设计取舍（理由都写进代码注释了）

- **不自己发 `ctx.llm.stream()`**：那要重做前缀缓存复用、模型回退与会话关联。`summarize()` 是 `protected`，子类直接 `super.summarize()` 是官方设计的扩展点。
- **追加的指导只进辅助调用，不写会话日志**：`CONTEXT-CONTINUUM-INDEX-V1` 在会话日志里出现 0 次。
- **服务键不受类名影响**：官方构造函数写死 `super(ctx, "compaction")`（`dsh-compaction/lib/index.js:171`），键名不从类名推导。
- **`ctx.sessionQuery` 必须惰性取**：构造那一刻 `sessionQuery` 可能尚未注册，在 `ctx.inject(['tools'])` 回调里按值捕获会**永久**拿到 `undefined`（真实宿主踩到：工具进了请求、模型也调了，却返回"会话检索面不可用"）。
- **不做 fork 式"新建会话切换"**：`SessionStore.fork(source, boundary)` 复制的是到 boundary 的**前缀**，给不了"只留最近尾巴"的裁剪窗口。DSH 里"在更小上下文里继续"的官方缝就是压缩事务。
- **nacre 只借思想、不借代码**：其许可为 AGPL-3.0，代码并入会传染；它"强制逐字锚点 + 原文回溯"的思想，宿主已用 `shadowedSeqs` 原生提供。

## 下一步增强点

1. 把「每条标题 + 该条区间的产物」加进 `context_anchors` 输出（见"超量归档与它的取舍"）。
2. `ctx.sessionQuery.traceEvent({sessionId, seq})` 返回 `replacedBy` / `replacementChain` /
   `replacedEventSeqs` / `sourceEventSeqs`（`dsh-session-query/lib/types/types.d.ts:82-102`），
   即官方替换链 API，比按 `shadowedSeqs` 取回更精确。
3. 标题质量：与其让模型自述，不如从该区间的**首个用户消息**里确定性取标题，做模型输出的兜底/交叉校验。

> `AUDIT.md` 是改造前的审计快照，其结论仍成立；但**设计描述以本文件为准**。
