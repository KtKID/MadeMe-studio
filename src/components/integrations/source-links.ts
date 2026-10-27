// 源码交付分支集中配置；仅在对应分支实际发布后调整，不假设 main 已包含集成。
const integrationSourceRoot =
  "https://github.com/KtKID/MadeMe-studio/tree/feat/v1/integrations";

export const integrationSourceLinks = {
  chromeClipper: `${integrationSourceRoot}/chrome-clipper`,
  obsidianPublisher: `${integrationSourceRoot}/obsidian-publisher`,
  guide: integrationSourceRoot,
} as const;
