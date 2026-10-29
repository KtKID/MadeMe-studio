import { useEffect, useRef, useState } from "react";
import { api } from "../../components/shared/ui";
import type {
  ArticleType,
  ArticleTypeMutation,
  ArticleTypesResponse,
} from "./contracts";

const eventName = "mademe:article-types";
let generation = 0;
let pendingMutation: Promise<unknown> = Promise.resolve();
/** 列表变更只广播公开类型元数据；不传播会话、文章正文或设置私有字段。 */
export function mutateArticleTypes(command: ArticleTypeMutation) {
  // 点击提交即授权此次写入；取消输入只停止回填，不回撤已发出/排队的请求。
  // 同页组件共享队列，避免两个写入的响应逆序把列表回退；失败不阻断后续操作。
  const operation = pendingMutation.then(async () => {
    const result = await api<ArticleTypesResponse>("/api/article-types", {
      method: "POST",
      body: JSON.stringify(command),
    });
    generation += 1;
    if (typeof window !== "undefined")
      window.dispatchEvent(
        new CustomEvent(eventName, { detail: result.types }),
      );
    return result;
  });
  pendingMutation = operation.catch(() => undefined);
  return operation;
}

export function loadArticleTypes() {
  return api<ArticleTypesResponse>("/api/article-types");
}

export function useArticleTypes(
  initialTypes: ArticleType[],
  { refreshOnMount = true }: { refreshOnMount?: boolean } = {},
) {
  const [types, setTypes] = useState(initialTypes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    const before = generation;
    setLoading(true);
    setError("");
    try {
      const result = await loadArticleTypes();
      // 写入成功后的广播优先，不能让更早发出的 GET 把新增类型撤回。
      if (current === request.current && before === generation)
        setTypes(result.types);
    } catch (failure) {
      if (current === request.current)
        setError(
          failure instanceof Error ? failure.message : "类型加载失败，请重试。",
        );
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    const update = (event: Event) => {
      request.current += 1;
      setTypes((event as CustomEvent<ArticleType[]>).detail);
      setLoading(false);
      setError("");
    };
    const focus = () => void refresh();
    window.addEventListener(eventName, update);
    window.addEventListener("focus", focus);
    if (refreshOnMount) void refresh();
    return () => {
      request.current += 1;
      window.removeEventListener(eventName, update);
      window.removeEventListener("focus", focus);
    };
  }, []);
  return { types, loading, error, refresh };
}
