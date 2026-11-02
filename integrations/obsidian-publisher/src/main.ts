import { throwIfAborted } from "../../../src/shared/request-cancellation.ts";
import {
  attachmentPlan,
  attachmentFile,
  type AttachmentCache,
} from "../../../src/modules/markdown-import/attachments.ts";
import { HARD_MAX_UPLOAD_BYTES } from "../../../src/modules/config/limits.ts";
import {
  App,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import {
  createDraftWithAttachments,
  draftInput,
  normalizeSiteUrl,
  normalizeToken,
  titleFromMarkdown,
} from "../../shared/client.ts";

type Settings = { site: string };

export default class MadeMePublisher extends Plugin {
  settings: Settings = { site: "" };
  sessionToken = "";
  private preview: DraftPreview | null = null;
  private inFlight = false;

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    if (typeof saved?.site === "string") this.settings.site = saved.site;
    this.addSettingTab(new PublisherSettings(this.app, this));
    this.addCommand({
      id: "preview-current-note",
      name: "Preview current note as MadeMe draft",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) this.previewCurrentNote(view);
        return true;
      },
    });
  }

  private previewCurrentNote(view: MarkdownView) {
    if (this.inFlight) {
      new Notice(
        "A MadeMe request is still running. Wait for its result before sending another note.",
      );
      return;
    }
    if (this.preview) {
      new Notice("A MadeMe preview is already open.");
      return;
    }
    try {
      const site = normalizeSiteUrl(this.settings.site);
      const token = normalizeToken(this.sessionToken);
      // 只读取当前笔记快照；预览确认后才读取其实际引用的附件。
      const markdown = view.editor.getValue();
      const input = draftInput({
        title: titleFromMarkdown(
          markdown,
          view.file?.basename || "Untitled note",
        ),
        markdown,
      });
      this.preview = new DraftPreview(
        this.app,
        site,
        token,
        input,
        view.file!.path,
        () => {
          this.preview = null;
        },
        (pending) => {
          this.inFlight = pending;
        },
      );
      this.preview.open();
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : "Cannot open the draft preview.",
      );
    }
  }

  onunload() {
    this.preview?.close();
    this.sessionToken = "";
  }
}

class DraftPreview extends Modal {
  private sending = false;
  private completed = false;
  private controller: AbortController | null = null;
  private attachmentCache: AttachmentCache = new Map();
  private files = new Map<
    string,
    { size: number; mtime: number; file: File }
  >();

  constructor(
    app: App,
    private site: string,
    private token: string,
    private input: { title: string; markdown: string },
    private sourcePath: string,
    private closed: () => void,
    private pending: (value: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Review your private draft" });
    contentEl.createEl("p", {
      text: `Destination: ${this.site}`,
      cls: "mademe-preview-destination",
    });
    contentEl.createEl("p", {
      text: "Only this note snapshot and its referenced media attachments will be sent. Linked notes are never uploaded. GIF animation is kept; MOV playback depends on its codec and browser. Nothing will be published.",
    });
    new Setting(contentEl).setName("Title").addText((text) =>
      text.setValue(this.input.title).onChange((value) => {
        this.input.title = value;
      }),
    );
    // 纯文本预览避免 Markdown 渲染触发远程图片或执行 HTML。
    contentEl.createEl("pre", {
      text: this.input.markdown,
      cls: "mademe-preview-body",
    });
    const status = contentEl.createEl("p", {
      cls: "mademe-preview-status",
      attr: { role: "status", "aria-live": "polite" },
    });
    let confirmed = false;
    const actions = new Setting(contentEl);
    actions.addButton((button) =>
      button.setButtonText("Cancel").onClick(() => this.close()),
    );
    actions.addButton((button) => {
      button
        .setButtonText("Save private draft")
        .setCta()
        .setDisabled(true)
        .onClick(async () => {
          if (!confirmed || this.sending || this.completed) return;
          this.sending = true;
          this.pending(true);
          button.setDisabled(true);
          status.setText(
            "Saving… Closing this window cannot retract an already sent request.",
          );
          try {
            const controller = new AbortController();
            this.controller = controller;
            // 仅枚举附件路径/大小元数据用于解析与同名检查，不读取其它笔记正文。
            const candidates = this.app.vault.getFiles().map((file) => {
              let cached = this.files.get(file.path);
              if (
                !cached ||
                cached.size !== file.stat.size ||
                cached.mtime !== file.stat.mtime
              ) {
                cached = {
                  size: file.stat.size,
                  mtime: file.stat.mtime,
                  file: new File([], file.name),
                };
                this.files.set(file.path, cached);
              }
              return {
                source: file,
                snapshot: cached,
                asset: { path: file.path, file: cached.file },
              };
            });
            const resolve = {
              mode: "root" as const,
              documentPath: this.sourcePath,
            };
            const plan = attachmentPlan(
              this.input.markdown,
              candidates.map((item) => item.asset),
              resolve,
            );
            const assets = [...new Set(plan.map((item) => item.asset))];
            // 零字节描述符不代表真实大小；所有引用先用 vault 元数据检查，再读任何二进制。
            for (const asset of assets) {
              const source = candidates.find((item) => item.asset === asset)!;
              if (source.snapshot.size > HARD_MAX_UPLOAD_BYTES)
                throw new Error(`附件超过上传硬上限：${source.source.name}`);
            }
            const result = await createDraftWithAttachments({
              site: this.site,
              token: this.token,
              ...this.input,
              assets,
              resolve,
              signal: controller.signal,
              cache: this.attachmentCache,
              readAttachment: async (asset) => {
                throwIfAborted(controller.signal);
                const item = candidates.find((item) => item.asset === asset)!;
                const file = item.source,
                  before = item.snapshot;
                if (before.size > HARD_MAX_UPLOAD_BYTES)
                  throw new Error(`附件超过上传硬上限：${file.name}`);
                if (
                  file.stat.size !== before.size ||
                  file.stat.mtime !== before.mtime
                )
                  throw new Error(`附件已变化，请重新预览：${file.name}`);
                // 顺序读取→上传，缓存仅保留 URL 和零字节描述符，不把整库附件装进内存。
                const bytes = await this.app.vault.readBinary(file);
                if (
                  before.size !== file.stat.size ||
                  before.mtime !== file.stat.mtime ||
                  bytes.byteLength !== before.size
                )
                  throw new Error(
                    `附件读取期间发生变化，请重新预览：${file.name}`,
                  );
                return attachmentFile(
                  new File([bytes], file.name, { lastModified: before.mtime }),
                );
              },
            });
            this.completed = true;
            status.setText(
              `Private draft saved (version ${result.version}). Review it in Studio before publishing.`,
            );
            contentEl.createEl("a", {
              text: "Open Studio",
              href: result.studioUrl,
              attr: { target: "_blank", rel: "noopener noreferrer" },
            });
            new Notice(
              "MadeMe private draft saved. Nothing has been published.",
            );
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Request failed. Check Studio before retrying.";
            status.setText(message);
            new Notice(message);
          } finally {
            this.controller = null;
            this.sending = false;
            this.pending(false);
            button.setDisabled(this.completed || !confirmed);
          }
        });
      new Setting(contentEl)
        .setName("I reviewed this content and destination")
        .setDesc(
          "Send this snapshot and its referenced media as a private draft. Requires posts:write and media:write for attachments.",
        )
        .addToggle((toggle) =>
          toggle.setValue(false).onChange((value) => {
            confirmed = value;
            button.setDisabled(!confirmed || this.sending || this.completed);
          }),
        );
    });
  }

  onClose() {
    if (this.sending)
      new Notice(
        "The request may still complete. Check Studio before sending this note again.",
      );
    this.controller?.abort();
    this.token = "";
    this.contentEl.empty();
    this.closed();
  }
}

class PublisherSettings extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: MadeMePublisher,
  ) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "MadeMe Publisher" });
    containerEl.createEl("p", {
      text: "Only the site origin is saved to plugin settings. Your token remains in memory for this Obsidian session; it is never written to the vault.",
    });
    let site = this.plugin.settings.site;
    let token = this.plugin.sessionToken;
    let tokenField: HTMLInputElement;
    new Setting(containerEl)
      .setName("Site origin")
      .setDesc("HTTPS, for example https://your-site.example")
      .addText((text) =>
        text
          .setPlaceholder("https://your-site.example")
          .setValue(site)
          .onChange((value) => {
            site = value;
            token = "";
            this.plugin.sessionToken = "";
            if (tokenField) tokenField.value = "";
          }),
      );
    new Setting(containerEl)
      .setName("API token for this session")
      .setDesc(
        "Use posts:write; add media:write when importing attachments. Re-enter after restarting.",
      )
      .addText((text) => {
        tokenField = text.inputEl;
        tokenField.type = "password";
        tokenField.autocomplete = "off";
        tokenField.spellcheck = false;
        text.setValue(token).onChange((value) => {
          token = value;
        });
      });
    new Setting(containerEl)
      .addButton((button) =>
        button
          .setButtonText("Save connection")
          .setCta()
          .onClick(async () => {
            try {
              const nextSite = normalizeSiteUrl(site);
              const nextToken = normalizeToken(token);
              // 只持久化原点，凭据不进入 data.json 或同步目录。
              await this.plugin.saveData({ site: nextSite });
              this.plugin.settings = { site: nextSite };
              this.plugin.sessionToken = nextToken;
              new Notice(
                "Site saved. Token is available only for this session.",
              );
            } catch (error) {
              new Notice(
                error instanceof Error
                  ? error.message
                  : "Cannot save the connection.",
              );
            }
          }),
      )
      .addButton((button) =>
        button.setButtonText("Forget token").onClick(() => {
          this.plugin.sessionToken = "";
          token = "";
          tokenField.value = "";
          new Notice("Session token cleared. Revoke it in Studio if needed.");
        }),
      );
  }
}
