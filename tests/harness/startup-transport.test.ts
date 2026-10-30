import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  startAppServer,
  type StdioRPC,
} from "../../integrations/codex-harness/transport";
let root = "";
let rpc: StdioRPC | undefined;
afterEach(async () => {
  rpc?.close();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
it("真实fake CLI启动：固定参数、独立HOME、初始化显式OAuth且不继承宿主secret", async () => {
  root = await mkdtemp(join(tmpdir(), "harness-fake-cli-"));
  const home = join(root, "home"),
    workspace = join(root, "tasks"),
    command = join(root, "fake-codex");
  await mkdir(home);
  await mkdir(workspace);
  vi.stubEnv("OPENAI_API_KEY", "must-not-inherit-fixture");
  await writeFile(
    command,
    `#!/usr/bin/env node\nlet init;let buf='';process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(m.method==='initialize')init=m.params;if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='probe'?{args:process.argv.slice(2),envKeys:Object.keys(process.env),home:process.env.HOME,codexHome:process.env.CODEX_HOME,init}:{}})+'\\n');}});`,
  );
  await chmod(command, 0o700);
  rpc = await startAppServer({
    command,
    codexHome: home,
    workspaceRoot: workspace,
    path: dirname(process.execPath),
  });
  const probe = (await rpc.request("probe")) as any;
  expect(probe.args).toEqual([
    "app-server",
    "--listen",
    "stdio://",
    "-c",
    "features.shell_tool=false",
    "-c",
    "mcp_servers={}",
    "-c",
    'web_search="disabled"',
    "-c",
    'cli_auth_credentials_store="ephemeral"',
  ]);
  expect(probe.envKeys).not.toContain("OPENAI_API_KEY");
  expect(probe.home).toBe(home);
  expect(probe.codexHome).toBe(home);
  expect(probe.init.capabilities).toMatchObject({
    explicitGatewayOauth: true,
    experimentalApi: false,
    requestAttestation: false,
  });
});
