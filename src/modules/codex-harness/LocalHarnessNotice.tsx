/** 托管博客不承载 Codex 订阅登录；没有本地配对时不能显示假可用按钮。 */
export default function LocalHarnessNotice() {
  return (
    <section className="config-card" aria-labelledby="codex-local-heading">
      <div className="field-heading">
        <h3 id="codex-local-heading">Codex 本地 Harness</h3>
        <span className="status-pill">独立本地运行</span>
      </div>
      <p>云端博客尚未配对本地运行器。此处不会启动登录，也不会访问你的本机。</p>
      <p className="form-hint">
        在同一台电脑启动独立运行器。API Key 输入仅在本地控制台提供，默认只保留在进程内存；云预览不收集密钥。
      </p>
      <p className="form-hint">
        测试默认回放：需先由你明确点击真实运行，录制固定公开样本；一次任务可能产生多次模型请求及费用。未录制或模型、内容、协议不匹配时会拒绝，不自动转为付费调用。
      </p>
    </section>
  );
}
