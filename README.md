# @local/dsh-context-continuum

把 DeepSeek Harness 的上下文压缩从「滚动重写的叙事摘要」改成「只追加的会话索引」。

> **征集协助中** —— 见 [docs/DEFECTS.md](docs/DEFECTS.md)。三条实测缺陷已用真实宿主日志取证，
> 欢迎提 issue / PR，尤其是第 1 条（功能性失败）。

---

## 它解决什么问题

官方引擎的压缩替换区间**起点恰好是上一份摘要的 seq**（实测 9/9 次），
也就是**每代都在重写旧摘要**。早期内容被反复磨平。

同会话 A/B 实测（[docs/AB-report.md](docs/AB-report.md)）：

| 指标 | 官方滚动摘要 | 本插件的会话索引 |
|---|---|---|
| 早期字面事实存活率 | **0 / 407** | 条目逐字继承，不再被重写 |
| 摘要长度轨迹 | 13,762 → 20,029 字 | 154 → 3,079 字（≈110 字/代） |
| 官方叙事结构泄漏 | 每代都有 | 0 / 27 代 |

机制根源不是「模型写得不好」，而是**替换区间起点错位**。原文在 append-only 日志里一条不少，
本插件的做法是：模型只写一个新条目，装配器把旧条目**逐字搬运**过来。

## 它提供什么

| 工具 | 用途 |
|---|---|
| `context_anchors` | 看被压掉了什么：compactionId、被压 seq 区间、token 数、摘要模型 |
| `context_read` | 按锚点取回被压缩掉的**逐字原文**（原文从未被删除，只是被遮蔽） |
| `context_compact` | 手动就地压缩 |

序号 `T<n>` 与第 n 个**成功**压缩事务一一对应。压缩失败时不编号，
以「无条目 + 失败原因」呈现 —— 账本不把失败的压缩伪装成成功的。

## 如何安装

三层接线，缺一层不生效：

| 层 | 位置 | 作用 |
|---|---|---|
| ① bundle patch | 本仓库 `cordis.patch.yml` | 置灰顶层 `compaction-basic`，`insert` 本插件行 |
| ② profile 用户层 | 目标 profile 的 `cordis.patch.yml` | 新增 `preset-continuum`（`standard` 的确定性变换） |
| ③ 依赖与解析 | profile 的 `package.json` + `node_modules/@local/dsh-context-continuum` | 让包可解析 |

### 快速上手（Windows）

```powershell
# 1. 备份 profile
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item "$p\package.json" "$p\package.json.bak" -Force
Copy-Item "$p\cordis.patch.yml" "$p\cordis.patch.yml.bak" -Force

# 2. 接线（见上表 ①②）
#    - package.json：bundles 数组加 "@local/dsh-context-continuum"
#    - cordis.patch.yml：追加 preset-continuum 块

# 3. 依赖（Windows 用目录联接，不用符号链接 —— dsh 解析不了符号链接）
cmd /c mklink /J "$p\node_modules\@local\dsh-context-continuum" "<本仓库路径>"

# 4. 重启 DeepSeek Harness

# 5. 会话里选「continuum」这个 agent preset
```

> **第 5 步别漏。** 本插件**没有替你改默认值**（避免擅自动你的会话），
> 不选就还是 `standard`，工具挂不上。

### 回退

```powershell
Copy-Item "$p\package.json.bak" "$p\package.json" -Force
Copy-Item "$p\cordis.patch.yml.bak" "$p\cordis.patch.yml" -Force
cmd /c rmdir "$p\node_modules\@local\dsh-context-continuum"
```

> 删目录联接用 `cmd /c rmdir`，**不要用 `Remove-Item -Recurse`**（后者在旧版 PowerShell
> 上会顺着联接删到源目录内容）。

## 架构

它是**官方引擎的子类**，只覆写 `summarize()`，不重做压缩机制：

```
ContinuumCompactionEngine extends BasicCompactionEngine
  └─ override summarize()          ← 唯一被替换的点：这次压缩产出什么
       └─ super.summarize()       ← 缓存复用 / 模型回退 / 会话关联全借官方的
```

| 文件 | 职责 |
|---|---|
| `src/engine.ts` | 压缩后端本体 + 注册三个工具 |
| `src/indexlog.ts` | 索引模板、旧条目逐字继承、强制丢弃叙述正文、超量归档 |
| `src/artifacts.ts` | 权威产物账本 `deliverables/presented` |
| `src/anchors.ts` | 从日志归并锚点账本 |
| `src/trace.ts` | 按锚点取回逐字原文 |
| `src/tools.ts` | `context_anchors` / `context_read` / `context_compact` |

不自己发 `ctx.llm.stream()`：那要重做前缀缓存复用、模型回退与会话关联。
`summarize()` 是 `protected`，子类直接调用正是官方设计的扩展点。

## 参数

```yaml
thresholdRatio: 0.5        # 触发阈值（官方默认 0.8；大窗口模型建议调低）
headroomTokens: 65536      # 生成余量
retainRatio: 0.16          # 保留最近 16% 原文尾巴
maxOverflowRetries: 1      # provider 报 CONTEXT_WINDOW_EXCEEDED 后强制压缩并重试
compactionRetries: 1
auto: true
```

**已知硬约束**（改参数前请读）：

| 配置 / 情形 | 后果 |
|---|---|
| `headroomTokens: 0` | 官方断言直接拒：`must be a positive integer`，**整个条目不激活** |
| `maxTokens` 过小 | 摘要被截断，引擎报 `summarization truncated at the token cap` 并拒绝安装 |
| `retainRatio >= thresholdRatio` | 没有可压区间，`compactIfNeeded` 返回 `null` |
| 摘要不比原文小 | 引擎主动拒绝 → 由归档机制兜住（表层封顶 24 条） |

## 本地验证

```bash
npm install
npm test            # 101 项单测 / 10 个文件
npm run typecheck   # 对真实 @deepseek-ai/dsh-*@0.2.0-rc.2 声明做类型检查
npm run build       # 产出 lib/
```

`tsconfig.json` 是 `noEmit: true`（只做类型检查），真正的构建走 `tsconfig.build.json`。
**先删 `lib/` 再构建** —— 否则旧产物会冒充「构建成功」。

## 已知缺陷（征集修复中）

见 [docs/DEFECTS.md](docs/DEFECTS.md)。摘要：

1. **压缩把存在的任务信息判成「信息不足」**（高，功能性失败）
2. **`<think>` 泄漏进条目**（中；README 曾声称 0 泄漏，实测是反例）
3. **压缩触发过晚 + 不控制上下文总量**（中，定位偏差）

## 文档

| 文件 | 内容 |
|---|---|
| [docs/DEFECTS.md](docs/DEFECTS.md) | 桌面真实宿主实测缺陷报告（含日志取证） |
| [docs/AB-report.md](docs/AB-report.md) | 官方摘要 vs 会话索引的 A/B 实测 |
| [docs/host-evidence-desktop.txt](docs/host-evidence-desktop.txt) | 桌面宿主上的 agent 侧报文原文 |
| [docs/retrieval-benchmark.md](docs/retrieval-benchmark.md) | 检索口径实测 |
| [docs/AUDIT.md](docs/AUDIT.md) | 改造前的审计快照 |

## 致谢

`nacre` 的「强制逐字锚点 + 原文回溯」思想对本插件有启发（仅借思想、不借代码，
其许可为 AGPL-3.0，代码并入会传染）。宿主已用 `shadowedSeqs` 原生提供锚点基础。

## License

MIT