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
        在同一台电脑启动独立运行器并打开本地控制台，再通过官方网页登录
        Codex。支持选区润色与生图任务；账户及工具实际可用性需登录后验收。网站账号与
        Codex 账号相互独立。
      </p>
    </section>
  );
}
