import { describe, expect, it } from 'vitest';
import { createPostSchema, patchPostSchema, settingsSchema, defaultSettings } from '../../src/shared/contracts';
describe('统一业务协议',()=>{
 it('创建草稿与并发版本协议校验',()=>{
  expect(createPostSchema.safeParse({title:'文章',blocks:[]}).success).toBe(true);
  expect(patchPostSchema.safeParse({title:'文章'}).success).toBe(false);
 });
 it('外观维度独立且默认微软雅黑',()=>{
  expect(settingsSchema.parse(defaultSettings).font).toBe('yahei');
  expect(settingsSchema.parse({...defaultSettings,mode:'dark'}).skin).toBe(defaultSettings.skin);
 });
});
