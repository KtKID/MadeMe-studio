import { useEffect, useRef, useState } from "react";
import { installUnsavedGuard } from "../shared/unsaved-guard";
import {
  Check,
  Plus,
  Trash2,
  Save,
  Palette,
  Sun,
  Moon,
  Monitor,
  SlidersHorizontal,
  Sparkles,
  Code2,
  Globe2,
  LockKeyhole,
} from "lucide-react";
import { api, type Settings, Notice, Busy } from "../shared/ui";
import {
  patchSettingsSchema,
  type AIAction,
  type Provider,
} from "../../shared/contracts";
import { settingsPatch, reconcileSettingsResponse } from "./settings-state";
import { providerLabels, normalizeImageModel } from "./model-options";
const skins = [
  {
    id: "amber",
    name: "暖阳",
    description: "温暖黄色，留白与文字",
    accent: "#d4a72c",
  },
  {
    id: "sage",
    name: "苔绿",
    description: "自然色调，灵感生长",
    accent: "#8ea88a",
  },
  {
    id: "rose",
    name: "暮粉",
    description: "柔和轻盈，安静表达",
    accent: "#d2989a",
  },
  {
    id: "ocean",
    name: "海蓝",
    description: "清爽开阔，思路自由",
    accent: "#81abc6",
  },
  {
    id: "mono",
    name: "素色",
    description: "纯粹中性，专注内容",
    accent: "#b4b4ae",
  },
] as const;
export default function SettingsPanel({
  initial,
  authenticated,
}: {
  initial: Settings;
  authenticated: boolean;
}) {
  const [settings, setSettings] = useState(initial);
  const baseline = useRef(initial);
  const draftRef = useRef(initial);
  const saveLock = useRef(false);
  function setDraft(update: Settings | ((previous: Settings) => Settings)) {
    const next =
      typeof update === "function" ? update(draftRef.current) : update;
    draftRef.current = next;
    setSettings(next);
  }
  const dirty =
    Object.keys(settingsPatch(baseline.current, settings)).length > 0;
  useEffect(() => {
    if (dirty) return installUnsavedGuard(window);
  }, [dirty]);
  const [tab, setTab] = useState("general");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [modelLists, setModelLists] = useState<
    Record<string, { id: string }[]>
  >({});
  const [loadingModels, setLoadingModels] = useState("");
  async function loadModels(id: string) {
    setLoadingModels(id);
    setError("");
    try {
      const result = await api<{ models: { id: string }[] }>(
        `/api/providers/${id}/models`,
      );
      setModelLists((previous) => ({ ...previous, [id]: result.models }));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoadingModels("");
    }
  }
  useEffect(() => {
    if (location.hash === "#models") setTab("models");
  }, []);
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMessage("");
  }
  async function save() {
    if (saveLock.current || !authenticated) return;
    const captured = draftRef.current;
    const submitted = {
      ...captured,
      providers: captured.providers.map(normalizeImageModel),
    };
    setError("");
    try {
      const patch = patchSettingsSchema.parse(
        settingsPatch(baseline.current, submitted),
      );
      if (!Object.keys(patch).length) {
        setMessage("没有未保存的设置。");
        return;
      }
      saveLock.current = true;
      setBusy(true);
      const response = await api<{ settings: Settings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const next = reconcileSettingsResponse(
        captured,
        draftRef.current,
        response.settings,
      );
      baseline.current = response.settings;
      setDraft(next);
      document.documentElement.dataset.theme = response.settings.theme;
      document.documentElement.dataset.mode = response.settings.mode;
      document.documentElement.dataset.skin = response.settings.skin;
      document.documentElement.dataset.font = response.settings.font;
      document.body.style.removeProperty("--accent");
      if (response.settings.accent)
        document.documentElement.style.setProperty(
          "--accent",
          response.settings.accent,
        );
      else document.documentElement.style.removeProperty("--accent");
      setMessage(
        Object.keys(settingsPatch(response.settings, next)).length
          ? "已保存先前设置；你刚做的新修改仍未保存。"
          : "设置已保存，站点已使用新配置。",
      );
    } catch (error) {
      setError((error as Error).message);
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  function provider(index: number, patch: Partial<Provider>) {
    change(
      "providers",
      settings.providers.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>一个属于你的地方。</h1>
          <p>外观、表达方式与创作工具，都由你决定。</p>
          <p className="settings-dirty" aria-live="polite">
            {dirty ? "有未保存设置" : "设置已同步"}
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy || !authenticated}
          onClick={save}
        >
          {busy ? (
            <Busy />
          ) : (
            <>
              <Save size={16} />
              保存设置
            </>
          )}
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      {!authenticated && <Notice>设置仅限已认证作者修改。</Notice>}
      <p className="form-hint">
        不同字段独立保存，不覆盖其他窗口的设置；同一字段在多个窗口同时修改时，以最后一次成功保存为准。
      </p>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {[
            { id: "general", name: "站点信息", icon: Globe2 },
            { id: "appearance", name: "主题与字体", icon: Palette },
            { id: "models", name: "AI 模型", icon: SlidersHorizontal },
            { id: "prompts", name: "提示词", icon: Sparkles },
            { id: "code", name: "自定义代码", icon: Code2 },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={17} />
              {t.name}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          {tab === "general" && (
            <>
              <div className="section-heading">
                <h2>把自己的名字，写在这里。</h2>
                <p>这些信息会显示在你的站点首页。</p>
              </div>
              <div className="form-stack">
                <label>
                  站点名称
                  <input
                    value={settings.siteTitle}
                    onChange={(e) => change("siteTitle", e.target.value)}
                    maxLength={80}
                  />
                </label>
                <label>
                  一句话介绍
                  <textarea
                    rows={3}
                    value={settings.tagline}
                    onChange={(e) => change("tagline", e.target.value)}
                    maxLength={240}
                  />
                </label>
                <div className="field-heading">
                  <h3>导航链接</h3>
                  <button
                    className="text-button"
                    onClick={() =>
                      change("navigation", [
                        ...settings.navigation,
                        { label: "新链接", href: "/" },
                      ])
                    }
                  >
                    <Plus size={15} />
                    添加链接
                  </button>
                </div>
                {settings.navigation.map((n, i) => (
                  <div className="navigation-row" key={i}>
                    <input
                      aria-label={`导航 ${i + 1} 名称`}
                      value={n.label}
                      onChange={(e) =>
                        change(
                          "navigation",
                          settings.navigation.map((v, j) =>
                            i === j ? { ...v, label: e.target.value } : v,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`导航 ${i + 1} 地址`}
                      value={n.href}
                      placeholder="/ 或 https://…"
                      onChange={(e) =>
                        change(
                          "navigation",
                          settings.navigation.map((v, j) =>
                            i === j ? { ...v, href: e.target.value } : v,
                          ),
                        )
                      }
                    />
                    <button
                      className="icon-button danger"
                      aria-label="移除此链接"
                      onClick={() =>
                        change(
                          "navigation",
                          settings.navigation.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <p className="form-hint">
                  支持站内路径和 HTTPS 链接，不接受脚本地址。
                </p>
              </div>
            </>
          )}
          {tab === "appearance" && (
            <>
              <div className="section-heading">
                <h2>文字之外，也有你的风格。</h2>
                <p>皮肤、明暗、字体各自独立，组合成你喜欢的样子。</p>
              </div>
              <h3>首页布局</h3>
              <div
                className="layout-options"
                role="group"
                aria-label="首页布局"
              >
                {[
                  {
                    id: "paper",
                    name: "编辑刊物",
                    detail: "首篇大图 · 清晰分栏",
                  },
                  { id: "ink", name: "时间线", detail: "横向列表 · 连续阅读" },
                  { id: "garden", name: "画廊", detail: "视觉卡片 · 素材优先" },
                  { id: "mono", name: "极简", detail: "纯文字 · 轻量目录" },
                ].map((layout) => (
                  <button
                    key={layout.id}
                    aria-pressed={settings.theme === layout.id}
                    className={settings.theme === layout.id ? "active" : ""}
                    onClick={() =>
                      change("theme", layout.id as Settings["theme"])
                    }
                  >
                    <strong>{layout.name}</strong>
                    <small>{layout.detail}</small>
                  </button>
                ))}
              </div>
              <h3>明暗模式</h3>
              <div className="mode-options" role="group" aria-label="明暗模式">
                {[
                  { id: "light", name: "浅色", icon: Sun },
                  { id: "dark", name: "深色", icon: Moon },
                  { id: "system", name: "跟随系统", icon: Monitor },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    aria-pressed={settings.mode === mode.id}
                    className={settings.mode === mode.id ? "active" : ""}
                    onClick={() => change("mode", mode.id as Settings["mode"])}
                  >
                    <mode.icon size={16} />
                    {mode.name}
                  </button>
                ))}
              </div>
              <h3>配色皮肤</h3>
              <div className="theme-grid">
                {skins.map((t) => (
                  <button
                    className={`theme-choice skin-preview-${t.id} ${settings.skin === t.id ? "selected" : ""}`}
                    key={t.id}
                    onClick={() => {
                      setDraft((prev) => ({
                        ...prev,
                        skin: t.id,
                      }));
                      setMessage("");
                    }}
                    aria-pressed={settings.skin === t.id}
                  >
                    <div className="theme-miniature">
                      <div className="mini-nav" />
                      <div className="mini-title" />
                      <div className="mini-line" />
                      <div className="mini-cards">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <div className="theme-caption">
                      <strong>{t.name}</strong>
                      {settings.skin === t.id && <Check size={16} />}
                      <small>{t.description}</small>
                    </div>
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  自定义强调色（可选）
                  <div className="color-input">
                    <input
                      type="color"
                      value={
                        settings.accent ||
                        skins.find((s) => s.id === settings.skin)!.accent
                      }
                      onChange={(e) => change("accent", e.target.value)}
                    />
                    <span>{settings.accent || "使用皮肤默认色"}</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!settings.accent}
                      onClick={() => change("accent", null)}
                    >
                      恢复皮肤默认
                    </button>
                  </div>
                </label>
                <label>
                  正文字体
                  <select
                    value={settings.font}
                    onChange={(e) =>
                      change("font", e.target.value as Settings["font"])
                    }
                  >
                    <option value="yahei">微软雅黑（默认系统字体）</option>
                    <option value="sans">系统无衬线</option>
                    <option value="serif">经典衬线</option>
                    <option value="mono">利落等宽</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {tab === "models" && (
            <>
              <div className="section-heading">
                <h2>让工具，跟上你的思路。</h2>
                <p>选择服务商与模型，密钥始终保留在服务器。</p>
              </div>
              <Notice>
                <LockKeyhole size={17} />
                不要在此粘贴 API 密钥。请在部署环境的 Secrets
                中配置服务商密钥；此处只保存模型元数据，不会访问你的本地凭据。
              </Notice>
              {settings.providers.map((p, i) => (
                <div className="config-card" key={p.id}>
                  <div className="field-heading">
                    <strong>{p.name || "新模型"}</strong>
                    <div>
                      <span
                        className={`status-pill ${p.configured ? "published" : ""}`}
                      >
                        {p.configured ? "密钥已配置" : "等待服务端密钥"}
                      </span>
                      <button
                        className="icon-button danger"
                        title="移除模型"
                        onClick={() =>
                          change(
                            "providers",
                            settings.providers.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="form-grid">
                    <label>
                      显示名称
                      <input
                        value={p.name}
                        onChange={(e) => provider(i, { name: e.target.value })}
                      />
                    </label>
                    <label>
                      服务商
                      <select
                        value={p.kind}
                        onChange={(e) =>
                          provider(i, {
                            kind: e.target.value as Provider["kind"],
                          })
                        }
                      >
                        {Object.entries(providerLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      模型 ID
                      <input
                        value={p.model}
                        list={`models-${p.id}`}
                        onChange={(e) => provider(i, { model: e.target.value })}
                        placeholder="填写服务商提供的文本模型 ID"
                      />
                      <datalist id={`models-${p.id}`}>
                        {(modelLists[p.id] || []).map((model) => (
                          <option key={model.id} value={model.id} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        className="text-button"
                        disabled={loadingModels === p.id || !p.configured}
                        onClick={() => loadModels(p.id)}
                      >
                        {loadingModels === p.id
                          ? "读取中…"
                          : "获取已保存配置的模型列表"}
                      </button>
                    </label>
                    <label>
                      图像模型（选填）
                      <input
                        value={p.imageModel || ""}
                        onChange={(e) =>
                          provider(i, { imageModel: e.target.value })
                        }
                        placeholder="留空使用服务端默认图像模型"
                      />
                      <small>
                        与文本模型独立。API 密钥仍只保存在服务端 Secrets。
                      </small>
                    </label>
                    <label>
                      Temperature
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={p.temperature}
                        onChange={(e) =>
                          provider(i, { temperature: +e.target.value })
                        }
                      />
                    </label>
                    <label>
                      最大输出 Token
                      <input
                        type="number"
                        min="16"
                        max="16384"
                        value={p.maxTokens}
                        onChange={(e) =>
                          provider(i, { maxTokens: +e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button
                className="button"
                onClick={() =>
                  change("providers", [
                    ...settings.providers,
                    {
                      id: `model_${crypto.randomUUID().slice(0, 8)}`,
                      name: "新的写作模型",
                      kind: "openai",
                      model: "",
                      temperature: 0.7,
                      maxTokens: 2048,
                      configured: false,
                    },
                  ])
                }
              >
                <Plus size={16} />
                添加模型
              </button>
              <p className="form-hint">
                仅支持服务端白名单供应商。自定义任意端点被禁用，以防服务器请求伪造。
              </p>
            </>
          )}
          {tab === "prompts" && (
            <>
              <div className="section-heading">
                <h2>找到你习惯的表达方式。</h2>
                <p>为不同写作动作保存专属提示词。</p>
              </div>
              {settings.prompts.map((p, i) => (
                <div className="config-card" key={p.id}>
                  <div className="form-grid">
                    <label>
                      名称
                      <input
                        value={p.name}
                        onChange={(e) =>
                          change(
                            "prompts",
                            settings.prompts.map((v, j) =>
                              j === i ? { ...v, name: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      动作
                      <select
                        value={p.action}
                        onChange={(e) =>
                          change(
                            "prompts",
                            settings.prompts.map((v, j) =>
                              j === i
                                ? { ...v, action: e.target.value as AIAction }
                                : v,
                            ),
                          )
                        }
                      >
                        {[
                          "rewrite",
                          "polish",
                          "expand",
                          "translate",
                          "title",
                          "excerpt",
                          "tags",
                          "slug",
                        ].map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    提示词模板
                    <textarea
                      rows={5}
                      value={p.template}
                      onChange={(e) =>
                        change(
                          "prompts",
                          settings.prompts.map((v, j) =>
                            j === i ? { ...v, template: e.target.value } : v,
                          ),
                        )
                      }
                      placeholder="保留原意，用自然、清晰的语言润色以下文字：{{selection}}"
                    />
                  </label>
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      change(
                        "prompts",
                        settings.prompts.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 size={14} />
                    删除提示词
                  </button>
                </div>
              ))}
              <button
                className="button"
                onClick={() =>
                  change("prompts", [
                    ...settings.prompts,
                    {
                      id: crypto.randomUUID(),
                      name: "我的润色风格",
                      action: "polish",
                      template:
                        "保留作者的原意，用自然清晰的语言润色：\n{{selection}}",
                    },
                  ])
                }
              >
                <Plus size={16} />
                添加提示词
              </button>
            </>
          )}
          {tab === "code" && (
            <>
              <div className="section-heading">
                <h2>自定义，但不牺牲安全。</h2>
                <p>代码仅在作者的隔离预览中呈现，不注入编辑器或公开页面。</p>
              </div>
              <Notice>
                预览采用无权限沙盒。脚本、表单、弹窗与访问站点登录状态均被禁止。此功能不是全站脚本注入器。
              </Notice>
              <label>
                HTML / CSS 片段
                <textarea
                  className="code-input"
                  rows={10}
                  value={settings.customCode}
                  onChange={(e) => change("customCode", e.target.value)}
                  spellCheck={false}
                  placeholder="<style>body { font-family: serif; }</style>\n<p>你的隔离预览</p>"
                />
              </label>
              {settings.customCode && (
                <iframe
                  className="code-preview"
                  title="自定义代码隔离预览"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={settings.customCode}
                />
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
