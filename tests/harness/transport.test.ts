import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { StdioRPC } from "../../integrations/codex-harness/transport";
const clients: StdioRPC[] = [];
afterEach(() => {
  for (const c of clients) c.close();
  clients.length = 0;
});
function fake(source: string, timeout = 3000) {
  const child = spawn(process.execPath, ["-e", source], {
    stdio: "pipe",
    env: {},
  });
  const rpc = new StdioRPC(child, timeout);
  clients.push(rpc);
  return rpc;
}
it("真实子进程stdio：请求关联、通知和审批拒绝，无真实Codex", async () => {
  const rpc = fake(
    `let buf='';process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(m.method==='test'){process.stdout.write(JSON.stringify({id:m.id,result:{ok:true}})+'\\n');process.stdout.write(JSON.stringify({method:'item/commandExecution/requestApproval',id:99,params:{command:'never execute'}})+'\\n');}else if(m.id===99){process.stdout.write(JSON.stringify({method:'denial',params:m})+'\\n');}}});`,
  );
  const denial = new Promise<any>((r) =>
    rpc.on("notification", (n) => {
      if (n.method === "denial") r(n.params);
    }),
  );
  expect(await rpc.request("test")).toEqual({ ok: true });
  expect(await denial).toMatchObject({
    id: 99,
    result: { decision: "cancel" },
  });
});
it("stdio超时不自动重发，子进程断开拒绝等待请求", async () => {
  const rpc = fake("process.stdin.resume();", 20);
  await expect(rpc.request("x")).rejects.toMatchObject({ code: "RPC_TIMEOUT" });
  rpc.close();
  await expect(rpc.request("y")).rejects.toMatchObject({
    code: "PROCESS_DISCONNECTED",
  });
});
