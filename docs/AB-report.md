# A/B 实测报告 v3（真实会话 session-<REDACTED>）

## 决定性发现：A 的 7703 token 买的是"最近的连贯叙述"，不是历史细节

| 区域 | 路径总数 | A 组摘要保留 | 保留率 |
|---|---|---|---|
| 早期（seq ≤ 848） | 146 | 10 | 6.8% |
| 之后 | 743 | 7 | 0.9% |

## 三方对比（早期专属事实）

| 方案 | 表层占用 | 早期事实存活 | 产物账本 |
|---|---|---|---|
| A 官方滚动重压 | 20029 字（≈7703 tok） | 0/407（0.0%） | 摘要含 6 条路径 |
| B 索引式不可变条目 | 1003 字（≈386 tok） | 0/407（0.0%） | **259 条结构化产物（243 条经校验存在）** |
| B + 锚点检索 | 索引 + 按需 | **407/407（100%）** | 同 B |

## 尺子修正记录（v1→v3）

1. v1：从 JSON 序列化文本抽事实却匹配原始文本 → 路径类永不命中（全代 0/71）。
2. v1：对计数类去空格规范化 → 22 条自己找不回自己。
3. v3 诊断：A 组 0/407 **经复核为真实结果**——严格与去空格匹配均为 0，但数字碎片仍在（26 个数字核心出现 16 个）→ 摘要提到数字、从不保留早期事实原形。
4. v3：产物来源修正——`workspace/changes` 载荷只含 `{turn}`，不含路径；权威产物账本是 `deliverables/presented` 的 `files[].path`。

## 产物账本全量

- `<USER_HOME>\\<AUDIT_TOOL>\\<AUDIT_TOOL>`
- `<USER_HOME>\\.dsh\\skills\`
- `<USER_HOME>\\<AUDIT_TOOL>\`
- `<USER_HOME>\`
- `<USER_HOME>\\<AUDIT_TOOL>\\<AUDIT_TOOL>`
- `<USER_HOME>\\\\.dsh\\\\skills`
- `<USER_HOME>\\<AUDIT_TOOL>\\index\`
- `<USER_HOME>\\<AUDIT_TOOL>\\<AUDIT_TOOL>`
- `<USER_HOME>\\<AUDIT_TOOL>\\schema\\rule_card.schema.json`
- `<USER_HOME>\\<AUDIT_TOOL>\\compiler.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\validate_cards.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\bench.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\fetch_stars.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\analyze.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\rescore.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\inspect_invented.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\run_all.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_flagged.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\rank_skills.py`
- `<USER_HOME>\\<AUDIT_TOOL>`
- `<USER_HOME>\\AppData\\Local\\Doubao\\User`
- `<USER_HOME>\\<AUDIT_TOOL>\\nightrun.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_stars.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\stage.py`
- `<USER_HOME>\\AppData\\Local\\Programs\\Python\\Python311\\python.exe`
- `<USER_HOME>\\<AUDIT_TOOL>\\daemon.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\watchdog.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\report.py`
- `t:\nreports/audit_sample.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\audit_sample.py`
- `T:\\n#`
- `<USER_HOME>\\<AUDIT_TOOL>\\probe_models.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\metrics\\model_probe.json`
- `<USER_HOME>\\<AUDIT_TOOL>\\health.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_top.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\batch_report.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_judge.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\judge_tests.json\`
- `<USER_HOME>\\<AUDIT_TOOL>\\runs\\policy.json`
- `<USER_HOME>\\<AUDIT_TOOL>\\audit_trace.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\rejudge.py`
- `<USER_HOME>\\\\.dsh\\\\skills\\\\full-output-enforcement\\\\SKILL.md，共`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\lead_audit.json`
- `<USER_HOME>\\<AUDIT_TOOL>\\tmp_show_dry.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\state_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\star_state.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_all.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\REPORT.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\BATCHES.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\REPORT.md` — 汇总报告（1400 行）：外部指标与排序、四模型基准与降噪优化、硬规则缺陷与机械修复、路由空转缺陷（L11）、被否掉的优化、Lead 审计记录
- `<USER_HOME>\<AUDIT_TOOL>\reports\BATCHES.md` — 分批结果清单：按技能统计（非日志记录），逐批给出当前判据下的通过率、平均引用落地率、编造标识符数
- `d:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\card_integrity.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\subset_export.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\keepawake.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\setup_tasks.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\setup_tasks2.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\deliverables\\TOP_N.md`
- `<USER_HOME>\<AUDIT_TOOL>\deliverables\TOP_N.md` — 高分技能包：308 张已通过当前判据的规则卡（按外部 star / 内部结构分排序，两类排名从不混用），含每张卡的判级、引用逐字落地率、卡片与源文 sha256
- `<USER_HOME>\\<AUDIT_TOOL>\\probe_split.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\diag_exits.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\runs\\daemon.log\`
- `<USER_HOME>\\<AUDIT_TOOL>\\diag_failctx.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\diag_race.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\diag_trace.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\cost_account.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\cost_structure.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\fix_daemons.ps1`
- `<USER_HOME>\\<AUDIT_TOOL>\\share_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\model_quality.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\head_to_head.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\audit_packet.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\completeness_gap.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\ab_prompt.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\hard_rules.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\backfill_hard_rules.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\audit_r2_recheck.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_r2.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\lead_audit.json\`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l11.py`
- `<USER_HOME>\<AUDIT_TOOL>\reports\lead_audit.json` — Lead 审计档案：L1–L11 逐条发现、根因、修复与修复后复验证据
- `<USER_HOME>\\<AUDIT_TOOL>\\model_real_quality.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l12.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l13_l14.py`
- `e:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\model_production_compare.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\low_grounding_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l15.py`
- `T:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\corpus_integrity.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\diagnose_stale.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\stale_impact.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\stale_root_cause.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\blind_spot_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\index_freshness.py`
- `n:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\hashutil.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\refresh_index_hashes.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l16_l17.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_provenance_fix.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\time_breakdown.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\bottleneck.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\waste_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\field_grounding.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\invention_proxy.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\polarity_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\fix_polarity.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l18_l20.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\anti_trigger_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\fix_anti_triggers.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l21.py`
- `s:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_batches.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l22.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\routing_reconcile.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\compare_assignment.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\routing_allocation.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l23.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l24.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\maintain.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l25.py`
- `o:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\spotcheck_sample.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\neg_gap_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\backfill_guardrails_verbatim.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\validate_new_criteria.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\check_fabricated_commands.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l26_l28.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\review_top_deliverable.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\adjudicate_top_review.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\label_pessimism_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\hard_rule_loss_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\guardrails_verbatim_residual.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l29_l31.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\routing_window_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l32.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\invented_fact_audit.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\correct_audit_l31_l33.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\hard_rule_miss_classify.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\correct_audit_l29_l34.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\local_cross_review.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\nested_export_gap.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_nested_export.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l35_l36.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reviewer_diagnose.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\cross_review_c.json\`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l37.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l38.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\stem_join_impact.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l39.py`
- `<USER_HOME>\\.dsh\\skills`
- `<USER_HOME>\\<AUDIT_TOOL>\\HANDOFF.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l40.py`
- `<USER_HOME>\<AUDIT_TOOL>\HANDOFF.md` — 交接与状态说明（已更新到当前真实状态）：含最重要的运行事实、四子目标状态、稳健速率与 ETA、库「顺手化」结果、验命令、诚实缺口、14 条方法论规则
- `<USER_HOME>\\<AUDIT_TOOL>\\export_completeness_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l41.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\correct_audit_l38_l42.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l43.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\patch_l43_evidence.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\vendor_review_minimax_c.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\vendor_review_codebuddy_c.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\vendor_review_cursor_c.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_vendor_omission.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l44.py`
- `<USER_HOME>\<AUDIT_TOOL>\reports\vendor_review_minimax_c.md` — MiniMax Code 对名次 26–30 五张榜首卡的独立审阅（10 条指认，含卡片字段、源文行号与原句）
- `<USER_HOME>\<AUDIT_TOOL>\reports\vendor_review_codebuddy_c.md` — CodeBuddy Code 对名次 31–35 五张卡的独立审阅（17 条指认，主动标注 2 处截断不可判定项）
- `<USER_HOME>\<AUDIT_TOOL>\reports\vendor_review_cursor_c.md` — Cursor Agent 对名次 36–41 五张卡的独立审阅（14 条指认，同样标注截断不可判定项）
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\corpus_survey.md\`
- `<USER_HOME>\\<AUDIT_TOOL>\\corpus_survey.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\category_signal.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\dedup_catalog.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\dedup_revert.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\skill_taxonomy.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\taxonomy_sample.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\taxonomy_debug.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\unclassified_sample.py`
- `p:\n\n`
- `<USER_HOME>\\<AUDIT_TOOL>\\build_router.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\export_batches.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\llm_out\\unclassified_01.minimax.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\llm_out\\unclassified_02.codebuddy.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\llm_out\\unclassified_03.cursor.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\merge_llm_taxonomy.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l45.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\ROUTER.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\DEDUP.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\CLASSIFY.md`
- `<USER_HOME>\<AUDIT_TOOL>\catalog\ROUTER.md` — 重建后的技能路由索引（2.9 KB，27 个领域）：先读它选定领域，再只读那一个领域文件
- `<USER_HOME>\<AUDIT_TOOL>\catalog\DEDUP.md` — 去重目录：146 组重复、保留规则、非破坏性处置方式与撤销方法
- `<USER_HOME>\<AUDIT_TOOL>\catalog\CLASSIFY.md` — 分类目录：26 类受控词表、五层判据与各类数量
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\llm_out\\unclassified_04.minimax.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\llm_out\\unclassified_05.codebuddy.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l46.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\biggest_bucket_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\saas_family_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\add_saas_category.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\saas_false_positive.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l47.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\saas_family_check.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\saas_family_check.md` — 缺类目测量与验证：为何新增 saas 类、131 个服务家族/1631 个技能的归属与误判率
- `<USER_HOME>\\<AUDIT_TOOL>\\description_quality.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\desc_rewrite.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\desc_review.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\desc_resolve_pointers.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\broken_shell_audit.py`
- `<USER_HOME>\\.dsh\\skills-enabled\`
- `<USER_HOME>\\<AUDIT_TOOL>\\pick_candidates.py`
- `<USER_HOME>\\\\.dsh\\\\skills-enabled`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l48.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\catalog\\PICK.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\broken_shells.md`
- `<USER_HOME>\<AUDIT_TOOL>\catalog\PICK.md` — 挑选启用清单：AI 实际只扫 skills-enabled；含当前 13 个启用项的分类位置、各类可启用候选数、启用前必须排除的两类
- `<USER_HOME>\<AUDIT_TOOL>\reports\broken_shells.md` — 空壳技能清单：88 个 SKILL.md 正文只是指向不存在文件的路径（含缺失目标分组）
- `<USER_HOME>\\<AUDIT_TOOL>\\build_test_package.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_desc_apply.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_package\\`
- `<USER_HOME>\\.dsh\\skills\\`
- `<USER_HOME>\\.dsh\\skills-enabled`
- `<USER_HOME>\\AppData\\Local\\Programs\\Python\\Python311\\python.exe\ncd`
- `<USER_HOME>\\<AUDIT_TOOL>\n$env:PYTHONIOENCODING=`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_package\\README.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_package\\usable_skills.txt`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_package\\improved_descriptions.tsv`
- `<USER_HOME>\<AUDIT_TOOL>\test_package\README.md` — 已更新的交付包说明（含单一高杠杆建议：注册 Rube MCP 可解锁 845 个技能）
- `<USER_HOME>\<AUDIT_TOOL>\test_package\usable_skills.txt` — 可直接使用的技能路径清单（8625 条，每行一个相对路径）
- `<USER_HOME>\<AUDIT_TOOL>\test_package\improved_descriptions.tsv` — 我改写的 97 条描述（技能路径 + 新描述）
- `<USER_HOME>\\<AUDIT_TOOL>\\name_collisions.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\collision_and_deps.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l50.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\collision_and_deps.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\collision_and_deps.md` — 同名冲突裁定 与 依赖缺口：8 组冲突逐组结论，以及 298 个依赖未注册 MCP 的技能
- `<USER_HOME>\\<AUDIT_TOOL>\\mcp_dependency_tiers.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\check_rube.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l52.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\mcp_dependency_tiers.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\mcp_dependency_tiers.md` — MCP 依赖分层报告：四层判据、各层真实样例、服务器集中度（845 个技能只依赖 Rube MCP 一个）
- `<USER_HOME>\\<AUDIT_TOOL>\\status_check.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\throughput_cause.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\retry_cause.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l53.py`
- `<USER_HOME>\\AppData\\Local\\Programs\\Python\\Python311\\python.exe\n\npython`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\STATUS.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\STATUS.md` — 端到端状态核查（一条命令重算所有对外数字，已修正为多窗口报告）
- `<USER_HOME>\\<AUDIT_TOOL>\\closeout_evidence.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\closeout_unclassified.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\closeout_evidence.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\closeout_evidence.md` — 收尾证据：SERVER 层 199 条逐条命中（含真实行与判定：真依赖 162 / 行文产物 37）+ 13 个未归类技能的正文与描述
- `<USER_HOME>\\<AUDIT_TOOL>\\verify_claims.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\record_audit_l55.py`
- `<USER_HOME>\\\\<AUDIT_TOOL>\\\\test_package\\\\`
- `<USER_HOME>\\\\.dsh\\\\skills\\\\`
- `<USER_HOME>\\\\<AUDIT_TOOL>\n$env:PYTHONIOENCODING=`
- `<USER_HOME>\\<AUDIT_TOOL>\\write_one_page.py`
- `<USER_HOME>\\<AUDIT_TOOL>\\reports\\CLAIM_VERIFICATION.md`
- `<USER_HOME>\\<AUDIT_TOOL>\\test_package\\ONE_PAGE.md`
- `<USER_HOME>\<AUDIT_TOOL>\reports\CLAIM_VERIFICATION.md` — 声明核验清单：交接文档的每条对外声明逐条重算，27 通过 / 0 不符 / 3 未复跑
- `<USER_HOME>\<AUDIT_TOOL>\test_package\ONE_PAGE.md` — 一页版：库 8859 / 可用 8622、重点怀疑的四条、三条复验命令
- `<USER_HOME>\\<AUDIT_TOOL>\\FINAL_REPORT.md`
- `<USER_HOME>\<AUDIT_TOOL>\FINAL_REPORT.md` — 最终报告：四个子目标的真实完成度、未完成的原因（硬件吞吐）、不敢保证的三条、会话结束后如何继续、以及若要继续的接手命令

## 索引（B 组）

```
## 会话索引（条目不可变，只追加）
### T1 [seq 8–848] text 请用一句话回答：你是 DeepSeek Harness 直接驱动的 agent 吗？当前模型配置是什么？ user user 21
- 产物：（本区间无产物记录）
### T2 [seq 650–1330] text Time sampled while preparing turn 6, step 19: 2026-10-05T15:28:58
- 产物：（本区间无产物记录）
### T3 [seq 1333–2066] text Time sampled while preparing turn 8, step 66: 2026-10-05T18:20:55
- 产物：（本区间无产物记录）
### T4 [seq 2069–2735] text Time sampled while preparing turn 9, step 41: 2026-10-05T23:02:10
- 产物：（本区间无产物记录）
### T5 [seq 2738–3643] text Time sampled while preparing turn 13, step 49: 2026-10-06T09:07:3
- 产物：（本区间无产物记录）
### T6 [seq 3437–3943] text <goal_round> Objective: "对 <USER_HOME>\\\\.dsh\\\\skills
- 产物：（本区间无产物记录）
### T7 [seq 3946–4608] text Time sampled while preparing turn 18, step 27: 2026-10-06T11:03:0
- 产物：（本区间无产物记录）
### T8 [seq 4614–5246] text Time sampled while preparing turn 21, step 41: 2026-10-06T11:33:0
- 产物：（本区间无产物记录）
### T9 [seq 5249–5761] text <goal_round> Objective: "对 <USER_HOME>\\\\.dsh\\\\skills
- 产物：（本区间无产物记录）
```