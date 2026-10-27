import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  CONFIG_TABS,
  DEFAULT_CONFIG,
  FIELD_META,
  GROUP_META,
  LIST_OPTIONS,
  MEDIA_CATEGORY_LABELS,
  MEDIA_TYPES,
  NUMBER_RANGES,
  configCrossProblems,
  runtimeConfigPatchSchema,
  type ConfigGroup,
  type MediaCategory,
  type RuntimeConfig,
  type SettingsConfigTab,
} from "../../modules/config";
import { embedProviders } from "../../modules/embed";
import { clientLog } from "../../modules/log/client";
import type { DeploymentItemView } from "../../shared/contracts";
import { api, Busy, Notice } from "../shared/ui";

type FieldProblems = Record<string, string>;
/**
 * 用与服务端相同的严格 schema 校验草稿配置；返回 “group.key → 中文错误”。
 * 不合法时保存按钮会直接报出这些原因，不会静默丢弃或夹紧。
 */
export function configProblems(config: RuntimeConfig): FieldProblems {
  const problems: FieldProblems = {};
  const result = runtimeConfigPatchSchema.safeParse(config);
  if (!result.success)
    for (const issue of result.error.issues) {
      const key = issue.path.slice(0, 2).join(".") || "limits";
      problems[key] ??= issue.message;
    }
  else
    for (const message of configCrossProblems(config))
      problems["security.tokenDefaultDays"] ??= message;
  return problems;
}
const mimeLabel = (mime: string) =>
  MEDIA_TYPES.find((t) => t.mime === mime)?.label ?? mime;
const embedLabel = (id: string) =>
  embedProviders.find((p) => p.id === id)?.name ?? id;
function NumberField({
  group,
  name,
  value,
  problem,
  onChange,
}: {
  group: ConfigGroup;
  name: string;
  value: number;
  problem?: string;
  onChange: (value: number) => void;
}) {
  const meta = (FIELD_META[group] as Record<string, { label: string; unit: string; description: string }>)[name];
  const range = (NUMBER_RANGES[group] as Record<string, { min: number; max: number }>)[name];
  const fallback = (DEFAULT_CONFIG[group] as Record<string, number>)[name];
  // 输入框保存原始文本，允许中途清空；非数字时交给 schema 报“请输入数字”。
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(Number.isFinite(value) ? String(value) : text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const unit = meta.unit ? ` ${meta.unit}` : "";
  return (
    <label className="config-field" data-config-field={`${group}.${name}`}>
      {meta.label}
      <span className="config-input">
        <input
          type="number"
          inputMode="numeric"
          min={range.min}
          max={range.max}
          step={1}
          value={text}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value));
          }}
        />
        {meta.unit && <span className="muted">{meta.unit}</span>}
      </span>
      <small className="form-hint">
        {meta.description} 默认 {fallback}
        {unit}，可调 {range.min}–{range.max}
        {unit}。
      </small>
      {problem && (
        <small className="config-error" role="alert">
          {problem}
        </small>
      )}
    </label>
  );
}
function ListField({
  group,
  name,
  value,
  problem,
  onChange,
}: {
  group: ConfigGroup;
  name: string;
  value: string[];
  problem?: string;
  onChange: (value: string[]) => void;
}) {
  const meta = (FIELD_META[group] as Record<string, { label: string; description: string }>)[name];
  const options = (LIST_OPTIONS as Record<string, Record<string, readonly string[]>>)[group][name];
  const toggle = (option: string, off: boolean) =>
    onChange(
      off
        ? [...value, option]
        : value.filter((item) => item !== option),
    );
  const box = (option: string, label: string) => (
    <label key={option}>
      <input
        type="checkbox"
        checked={!value.includes(option)}
        onChange={(e) => toggle(option, !e.target.checked)}
      />
      {label}
      <code>{option}</code>
    </label>
  );
  return (
    <fieldset className="scope-options" data-config-field={`${group}.${name}`}>
      <legend>{meta.label}（勾选 = 允许）</legend>
      <p className="form-hint">{meta.description} 默认全部允许。</p>
      {name === "disabledTypes"
        ? (Object.keys(MEDIA_CATEGORY_LABELS) as MediaCategory[]).map((category) => (
            <div key={category} className="config-mime-group">
              <strong>{MEDIA_CATEGORY_LABELS[category]}</strong>
              {MEDIA_TYPES.filter((t) => t.category === category).map((t) =>
                box(t.mime, mimeLabel(t.mime)),
              )}
            </div>
          ))
        : options.map((option) => box(option, embedLabel(option)))}
      {problem && (
        <small className="config-error" role="alert">
          {problem}
        </small>
      )}
    </fieldset>
  );
}
/** 设置页的一个配置标签页（上传与媒体 / AI 用量 / 账号与安全 / 嵌入与阅读）。 */
export function ConfigSection({
  tab,
  config,
  problems,
  onChange,
}: {
  tab: SettingsConfigTab;
  config: RuntimeConfig;
  problems: FieldProblems;
  onChange: (config: RuntimeConfig) => void;
}) {
  const definition = CONFIG_TABS.find((t) => t.id === tab)!;
  function set(group: ConfigGroup, key: string, value: unknown) {
    onChange({ ...config, [group]: { ...config[group], [key]: value } });
  }
  return (
    <>
      <div className="section-heading">
        <h2>{definition.label}</h2>
        <p>保存后从下一次请求开始生效；超出范围的值会被拒绝并提示原因。</p>
      </div>
      {definition.groups.map((group) => {
        const values = config[group] as Record<string, unknown>;
        const isDefault =
          JSON.stringify(values) === JSON.stringify(DEFAULT_CONFIG[group]);
        return (
          <div key={group} className="form-stack config-group" data-config-group={group}>
            <div className="config-group-heading">
              <h3>{GROUP_META[group].label}</h3>
              <button
                type="button"
                className="button"
                disabled={isDefault}
                onClick={() =>
                  onChange({ ...config, [group]: structuredClone(DEFAULT_CONFIG[group]) })
                }
              >
                <RotateCcw size={14} />
                恢复默认
              </button>
            </div>
            <p className="form-hint">{GROUP_META[group].description}</p>
            {Object.entries(values).map(([key, value]) =>
              Array.isArray(value) ? (
                <ListField
                  key={key}
                  group={group}
                  name={key}
                  value={value as string[]}
                  problem={problems[`${group}.${key}`]}
                  onChange={(v) => set(group, key, v)}
                />
              ) : (
                <NumberField
                  key={key}
                  group={group}
                  name={key}
                  value={value as number}
                  problem={problems[`${group}.${key}`]}
                  onChange={(v) => set(group, key, v)}
                />
              ),
            )}
          </div>
        );
      })}
      {tab === "security" && <DeploymentCard />}
    </>
  );
}
/** 只读部署信息：只显示“已配置 / 未配置”，密钥值永远不会下发到浏览器。 */
export function DeploymentCard() {
  const [items, setItems] = useState<DeploymentItemView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<{ deployment: DeploymentItemView[] }>("/api/deployment")
      .then((r) => live && setItems(r.deployment))
      .catch((e) => {
        clientLog("warn", "settings.deployment_failed", {
          message: (e as Error).message,
        });
        if (live) setError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="form-stack config-group" data-deployment-card="">
      <div className="config-group-heading">
        <h3>部署信息（只读）</h3>
      </div>
      <p className="form-hint">
        这些项在 Cloudflare 部署环境（wrangler / Secrets）中设置，不能在这里修改；这里只显示是否已配置，不显示任何密钥值。
      </p>
      {error && <Notice kind="error">部署信息读取失败：{error}</Notice>}
      {!items && !error && <Busy />}
      {items && (
        <ul className="deployment-list">
          {items.map((item) => (
            <li key={item.key} data-configured={item.configured ? "true" : "false"}>
              <span>{item.label}</span>
              <strong>
                {item.configured ? "已配置" : "未配置"}
                {item.note ? ` · ${item.note}` : ""}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
