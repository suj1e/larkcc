import * as lark from "@larksuiteoapi/node-sdk";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import type { Dispatcher } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";

// ── 代理感知 fetch ──────────────────────────────────────────────

let _proxyDispatcher: Dispatcher | undefined;

function getProxyDispatcher(): Dispatcher | undefined {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
  if (!proxyUrl) return undefined;
  if (!_proxyDispatcher) _proxyDispatcher = new ProxyAgent(proxyUrl);
  return _proxyDispatcher;
}

export function fetchWithProxy(url: string | URL, init?: Record<string, unknown>) {
  const dispatcher = getProxyDispatcher();
  return undiciFetch(url, dispatcher ? { ...init, dispatcher } : init);
}

export function createLarkClient(appId: string, appSecret: string) {
  return new lark.Client({ appId, appSecret });
}

export function createWSClient(appId: string, appSecret: string) {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY;
  const options: ConstructorParameters<typeof lark.WSClient>[0] & { agent?: any } = { appId, appSecret };
  if (proxyUrl) {
    options.agent = new HttpsProxyAgent(proxyUrl);
  }
  return new lark.WSClient(options as any);
}

// ── Token 管理 ──────────────────────────────────────────────────

const TOKEN_EXPIRY_BUFFER_S = 300;       // token 提前 5 分钟过期
const TOKEN_MIN_REMAINING_MS = 600_000;  // 剩余不足 10 分钟时刷新

let cachedToken: { token: string; expiresAt: number; appId: string } | null = null;

export function invalidateTokenCache(): void {
  cachedToken = null;
}

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  if (cachedToken && cachedToken.appId === appId && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetchWithProxy("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Get access token failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = JSON.parse(text) as { tenant_access_token?: string; expire?: number; code?: number; msg?: string };
  if (!data.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: ${data.msg ?? JSON.stringify(data)}`);
  }

  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + ((data.expire ?? 7200) - TOKEN_EXPIRY_BUFFER_S) * 1000,
    appId,
  };
  return cachedToken.token;
}

/** 使缓存的 token 在下次 getTenantAccessToken 调用时强制刷新（剩余不足 10 分钟时） */
export function checkTokenExpiry(): void {
  if (cachedToken && cachedToken.expiresAt - Date.now() < TOKEN_MIN_REMAINING_MS) {
    cachedToken = null;
  }
}

// ── 类型安全的 SDK wrapper ─────────────────────────────────────

/** SDK 类型缺失 reply_in_thread，用 wrapper 补齐 */
interface ReplyOptions {
  content: string;
  msgType: string;
  replyInThread?: boolean;
}

export async function replyMessage(
  client: lark.Client,
  msgId: string,
  options: ReplyOptions,
): Promise<{ messageId: string }> {
  const res = await (client.im.message as any).reply({
    path: { message_id: msgId },
    data: {
      content: options.content,
      msg_type: options.msgType,
      reply_in_thread: options.replyInThread ?? false,
    },
  });
  return { messageId: res?.data?.message_id ?? "" };
}

export async function patchMessage(
  client: lark.Client,
  msgId: string,
  content: string,
): Promise<void> {
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content },
  });
}

export async function sendMessage(
  client: lark.Client,
  chatId: string,
  content: string,
  msgType: string,
): Promise<{ messageId: string }> {
  const res = await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: msgType,
      content,
    },
  });
  return { messageId: (res.data as any)?.message_id ?? "" };
}
