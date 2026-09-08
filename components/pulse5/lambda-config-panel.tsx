"use client";

import { useState } from "react";
import { Settings2, X } from "lucide-react";
import type { LambdaConfig, LambdaIndicatorKey, LambdaMarketRegime } from "@/lib/pulse5/bots/lambda/LambdaConfig";
import type { AuthorityCompetitionPayload } from "@/lib/game/authority-client";

const signalNames: Record<LambdaIndicatorKey, string> = {
  shortReturn: "短线涨跌幅", slope: "价格斜率", movingAverage: "价格 / 均线", tickImbalance: "Tick 多空比",
  rangePosition: "区间位置", volatility: "波动率", momentumChange: "动量变化", breakout: "区间突破",
};
const regimeNames: Record<LambdaMarketRegime, string> = {
  trend: "趋势", range: "震荡", highVolatility: "高波动", lowVolatility: "低波动",
};

export function LambdaConfigPanel({ open, config, learning, onClose, onSave }: {
  open: boolean;
  config: LambdaConfig;
  learning: AuthorityCompetitionPayload["lambdaLearning"] | null;
  onClose: () => void;
  onSave: (config: LambdaConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const updateIndicator = (key: LambdaIndicatorKey, patch: Partial<LambdaConfig["indicators"][number]>) => {
    setDraft((value) => ({ ...value, indicators: value.indicators.map((item) => item.key === key ? { ...item, ...patch } : item) }));
  };
  const save = async () => {
    setSaving(true);
    try { await onSave(draft); onClose(); } finally { setSaving(false); }
  };

  return (
    <div className="lambda-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="lambda-panel" role="dialog" aria-modal="true" aria-labelledby="lambda-title">
        <header>
          <div><Settings2 aria-hidden="true" /><span><b id="lambda-title">Bot Lambda</b><small>无代码量化策略</small></span></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X aria-hidden="true" /></button>
        </header>

        <div className="lambda-scroll">
          <p className="lambda-note">只使用决策当时已产生的行情。参数在下一次扫描时生效。</p>
          {learning ? (
            <div className="lambda-growth">
              <div><strong>Lv. {learning.level}</strong><span>Generation {learning.generation}</span><em>{learning.stage}</em></div>
              <div className="lambda-exp-head"><span>EXP</span><b>{learning.expInLevel} / {learning.expToNextLevel}</b></div>
              <div className="lambda-exp" role="progressbar" aria-label="Lambda 学习进度" aria-valuemin={0} aria-valuemax={learning.expToNextLevel} aria-valuenow={learning.expInLevel}><i style={{ width: `${learning.expInLevel}%` }} /></div>
              {learning.recentReports[0] ? (
                <div className="lambda-learning-note">
                  <b>最近学习</b><span>{learning.recentReports[0].summary}</span>
                  {learning.recentReports[0].changes.map((change) => <small key={change}>{change}</small>)}
                </div>
              ) : <div className="lambda-learning-note"><b>最近学习</b><span>完成真实比赛并结算后开始积累经验。</span></div>}
            </div>
          ) : null}
          <div className="lambda-section-title"><b>信号组合</b><span>启用 · 窗口 · 权重</span></div>
          <div className="lambda-signals">
            {draft.indicators.map((item) => (
              <div className="lambda-signal" key={item.key}>
                <label><input type="checkbox" checked={item.enabled} onChange={(event) => updateIndicator(item.key, { enabled: event.target.checked })} />{signalNames[item.key]}</label>
                <select value={item.windowMs} onChange={(event) => updateIndicator(item.key, { windowMs: Number(event.target.value) })} aria-label={`${signalNames[item.key]}窗口`}>
                  {[15, 20, 30, 40, 60].map((seconds) => <option key={seconds} value={seconds * 1000}>{seconds}s</option>)}
                </select>
                <div className="lambda-stars" aria-label={`${signalNames[item.key]}权重`}>
                  {[1, 2, 3, 4, 5].map((weight) => <button type="button" key={weight} className={weight <= item.weight ? "active" : ""} onClick={() => updateIndicator(item.key, { weight })}>★</button>)}
                </div>
              </div>
            ))}
          </div>

          <div className="lambda-two-col">
            <div>
              <div className="lambda-section-title"><b>执行</b></div>
              <label className="lambda-field">最低 Edge <strong>{(draft.minEdge * 100).toFixed(1)}%</strong><input type="range" min="1" max="8" step="0.5" value={draft.minEdge * 100} onChange={(event) => setDraft({ ...draft, minEdge: Number(event.target.value) / 100 })} /></label>
              <label className="lambda-field">活跃度 <strong>{draft.activity}/3</strong><input type="range" min="1" max="3" step="1" value={draft.activity} onChange={(event) => setDraft({ ...draft, activity: Number(event.target.value) as 1 | 2 | 3 })} /></label>
              <label className="lambda-field">单笔上限 <strong>{(draft.maxSingleOrderRatio * 100).toFixed(0)}%</strong><input type="range" min="1" max="6" step="1" value={draft.maxSingleOrderRatio * 100} onChange={(event) => setDraft({ ...draft, maxSingleOrderRatio: Number(event.target.value) / 100 })} /></label>
              <label className="lambda-field">单轮敞口 <strong>{(draft.maxRoundExposureRatio * 100).toFixed(0)}%</strong><input type="range" min="10" max="25" step="1" value={draft.maxRoundExposureRatio * 100} onChange={(event) => setDraft({ ...draft, maxRoundExposureRatio: Number(event.target.value) / 100 })} /></label>
            </div>
            <div>
              <div className="lambda-section-title"><b>风格</b></div>
              <div className="lambda-choice">
                {(["fixed", "confidence", "edge"] as const).map((mode) => <button type="button" key={mode} className={draft.sizingMode === mode ? "active" : ""} onClick={() => setDraft({ ...draft, sizingMode: mode })}>{mode === "fixed" ? "固定" : mode === "confidence" ? "置信度" : "Edge"}</button>)}
              </div>
              <div className="lambda-regimes">
                {(Object.keys(regimeNames) as LambdaMarketRegime[]).map((regime) => <label key={regime}><input type="checkbox" checked={draft.marketRegimes[regime]} onChange={(event) => setDraft({ ...draft, marketRegimes: { ...draft.marketRegimes, [regime]: event.target.checked } })} />{regimeNames[regime]}</label>)}
              </div>
              <label className="lambda-toggle"><input type="checkbox" checked={draft.adaptiveHedge} onChange={(event) => setDraft({ ...draft, adaptiveHedge: event.target.checked })} /><span>仅在降低最坏损失时允许对冲</span></label>
            </div>
          </div>
          <div className="lambda-section-title"><b>附加条件</b><span>最多 4 条，支持 AND / OR</span></div>
          <div className="lambda-conditions">
            {draft.extraConditions.map((condition, index) => (
              <div key={index}>
                <select value={condition.join} disabled={index === 0} onChange={(event) => setDraft({ ...draft, extraConditions: draft.extraConditions.map((item, itemIndex) => itemIndex === index ? { ...item, join: event.target.value as "AND" | "OR" } : item) })}><option>AND</option><option>OR</option></select>
                <select value={condition.field} onChange={(event) => setDraft({ ...draft, extraConditions: draft.extraConditions.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value as typeof item.field } : item) })}><option value="edge">Edge</option><option value="volatility">波动率</option><option value="secondsRemaining">剩余秒数</option></select>
                <select value={condition.operator} onChange={(event) => setDraft({ ...draft, extraConditions: draft.extraConditions.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as "lt" | "gt" } : item) })}><option value="gt">大于</option><option value="lt">小于</option></select>
                <input type="number" step="0.01" value={condition.value} onChange={(event) => setDraft({ ...draft, extraConditions: draft.extraConditions.map((item, itemIndex) => itemIndex === index ? { ...item, value: Number(event.target.value) } : item) })} />
                <button type="button" onClick={() => setDraft({ ...draft, extraConditions: draft.extraConditions.filter((_, itemIndex) => itemIndex !== index) })}>删除</button>
              </div>
            ))}
            {draft.extraConditions.length < 4 ? <button type="button" className="lambda-add-condition" onClick={() => setDraft({ ...draft, extraConditions: [...draft.extraConditions, { field: "edge", operator: "gt", value: draft.minEdge, join: "AND" }] })}>+ 添加条件</button> : null}
          </div>
        </div>
        <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存策略"}</button></footer>
      </section>
    </div>
  );
}
