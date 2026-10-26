import { defineConfig } from 'vitest/config';
// 浏览器与 Node CLI 的验收分别运行，避免被单元测试运行器误收集。
export default defineConfig({test:{include:['tests/**/*.test.ts','tests/**/*.test.tsx'],exclude:['tests/e2e/**','node_modules/**','dist/**']}});
