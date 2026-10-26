import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { createDraft, draftInput, normalizeSiteUrl, normalizeToken, titleFromMarkdown } from '../../shared/client.ts';

type Settings = { site: string };

export default class MadeMePublisher extends Plugin {
  settings: Settings = { site: '' };
  sessionToken = '';
  private preview: DraftPreview | null = null;
  private inFlight = false;

  async onload() {
    const saved = await this.loadData() as Partial<Settings> | null;
    if (typeof saved?.site === 'string') this.settings.site = saved.site;
    this.addSettingTab(new PublisherSettings(this.app, this));
    this.addCommand({
      id: 'preview-current-note', name: 'Preview current note as MadeMe draft',
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) this.previewCurrentNote(view);
        return true;
      },
    });
  }

  private previewCurrentNote(view: MarkdownView) {
    if (this.inFlight) { new Notice('A MadeMe request is still running. Wait for its result before sending another note.'); return; }
    if (this.preview) { new Notice('A MadeMe preview is already open.'); return; }
    try {
      const site = normalizeSiteUrl(this.settings.site);
      const token = normalizeToken(this.sessionToken);
      // 只读取当前编辑器快照，不枚举 vault，也不读取附件或双链目标。
      const markdown = view.editor.getValue();
      const input = draftInput({ title: titleFromMarkdown(markdown, view.file?.basename || 'Untitled note'), markdown });
      this.preview = new DraftPreview(this.app, site, token, input, () => { this.preview = null; }, pending => { this.inFlight = pending; });
      this.preview.open();
    } catch (error) { new Notice(error instanceof Error ? error.message : 'Cannot open the draft preview.'); }
  }

  onunload() {
    this.preview?.close();
    this.sessionToken = '';
  }
}

class DraftPreview extends Modal {
  private sending = false;
  private completed = false;

  constructor(app: App, private site: string, private token: string, private input: { title: string; markdown: string }, private closed: () => void, private pending: (value: boolean) => void) { super(app); }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Review your private draft' });
    contentEl.createEl('p', { text: `Destination: ${this.site}`, cls: 'mademe-preview-destination' });
    contentEl.createEl('p', { text: 'Only this snapshot will be sent, including frontmatter. Attachments and linked notes are not uploaded. Nothing will be published.' });
    new Setting(contentEl).setName('Title').addText(text => text.setValue(this.input.title).onChange(value => { this.input.title = value; }));
    // 纯文本预览避免 Markdown 渲染触发远程图片或执行 HTML。
    contentEl.createEl('pre', { text: this.input.markdown, cls: 'mademe-preview-body' });
    const status = contentEl.createEl('p', { cls: 'mademe-preview-status', attr: { role: 'status', 'aria-live': 'polite' } });
    let confirmed = false;
    const actions = new Setting(contentEl);
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
    actions.addButton(button => {
      button.setButtonText('Save private draft').setCta().setDisabled(true).onClick(async () => {
        if (!confirmed || this.sending || this.completed) return;
        this.sending = true;
        this.pending(true);
        button.setDisabled(true);
        status.setText('Saving… Closing this window cannot retract an already sent request.');
        try {
          const result = await createDraft({ site: this.site, token: this.token, ...this.input });
          this.completed = true;
          status.setText(`Private draft saved (version ${result.version}). Review it in Studio before publishing.`);
          contentEl.createEl('a', { text: 'Open Studio', href: result.studioUrl, attr: { target: '_blank', rel: 'noopener noreferrer' } });
          new Notice('MadeMe private draft saved. Nothing has been published.');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Request failed. Check Studio before retrying.';
          status.setText(message);
          new Notice(message);
        } finally {
          this.sending = false;
          this.pending(false);
          button.setDisabled(this.completed || !confirmed);
        }
      });
      new Setting(contentEl).setName('I reviewed this content and destination').setDesc('Send only this note snapshot as a private draft.').addToggle(toggle => toggle.setValue(false).onChange(value => {
        confirmed = value;
        button.setDisabled(!confirmed || this.sending || this.completed);
      }));
    });
  }

  onClose() {
    if (this.sending) new Notice('The request may still complete. Check Studio before sending this note again.');
    this.token = '';
    this.contentEl.empty();
    this.closed();
  }
}

class PublisherSettings extends PluginSettingTab {
  constructor(app: App, private plugin: MadeMePublisher) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'MadeMe Publisher' });
    containerEl.createEl('p', { text: 'Only the site origin is saved to plugin settings. Your token remains in memory for this Obsidian session; it is never written to the vault.' });
    let site = this.plugin.settings.site;
    let token = this.plugin.sessionToken;
    let tokenField: HTMLInputElement;
    new Setting(containerEl).setName('Site origin').setDesc('HTTPS, for example https://your-site.example').addText(text => text.setPlaceholder('https://your-site.example').setValue(site).onChange(value => {
      site = value;
      token = '';
      this.plugin.sessionToken = '';
      if (tokenField) tokenField.value = '';
    }));
    new Setting(containerEl).setName('API token for this session').setDesc('Use only posts:write permission. Re-enter after restarting.').addText(text => {
      tokenField = text.inputEl;
      tokenField.type = 'password';
      tokenField.autocomplete = 'off';
      tokenField.spellcheck = false;
      text.setValue(token).onChange(value => { token = value; });
    });
    new Setting(containerEl).addButton(button => button.setButtonText('Save connection').setCta().onClick(async () => {
      try {
        const nextSite = normalizeSiteUrl(site);
        const nextToken = normalizeToken(token);
        // 只持久化原点，凭据不进入 data.json 或同步目录。
        await this.plugin.saveData({ site: nextSite });
        this.plugin.settings = { site: nextSite };
        this.plugin.sessionToken = nextToken;
        new Notice('Site saved. Token is available only for this session.');
      } catch (error) { new Notice(error instanceof Error ? error.message : 'Cannot save the connection.'); }
    })).addButton(button => button.setButtonText('Forget token').onClick(() => {
      this.plugin.sessionToken = ''; token = ''; tokenField.value = '';
      new Notice('Session token cleared. Revoke it in Studio if needed.');
    }));
  }
}
