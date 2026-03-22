/**
 * 飞书 OAuth 授权模块
 * 用于获取 user_access_token 以访问用户的个人云空间
 */

import http from "http";
import { AuthToken, loadAuthToken, saveAuthToken } from "./config.js";

const OAUTH_PORT = 9527;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;

// 飞书 OAuth 配置
const AUTH_URL = "https://open.feishu.cn/open-apis/authen/v1/authorize";
const TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const REFRESH_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";

// 所需权限：云文档读写
const REQUIRED_SCOPES = ["drive:file", "drive:file:upload", "docs:doc", "offline_access"];

/**
 * 生成授权链接
 */
export function generateAuthUrl(appId: string, state: string): string {
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: REDIRECT_URI,
    state,
    scope: REQUIRED_SCOPES.join(" "),
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * 启动本地服务器等待授权回调
 */
export function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>授权失败</h1><p>${error}</p><p>请关闭此页面并重试。</p>`);
          server.close();
          reject(new Error(error));
        } else if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>授权成功！</h1><p>请关闭此页面，回到终端继续。</p>`);
          server.close();
          resolve(code);
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<h1>无效请求</h1>`);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(OAUTH_PORT, () => {
      console.log(`OAuth 回调服务器已启动: http://localhost:${OAUTH_PORT}`);
    });

    // 5 分钟超时
    setTimeout(() => {
      server.close();
      reject(new Error("授权超时，请重试"));
    }, 5 * 60 * 1000);
  });
}

/**
 * 用授权码换取 access_token
 */
export async function exchangeCodeForToken(
  appId: string,
  appSecret: string,
  code: string
): Promise<AuthToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const data = await res.json() as any;

  if (data.code !== 0) {
    throw new Error(`获取 token 失败: ${data.msg || JSON.stringify(data)}`);
  }

  const now = Date.now();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + (data.expires_in * 1000),
    refresh_expires_at: now + (data.refresh_token_expires_in * 1000),
  };
}

/**
 * 刷新 access_token
 */
export async function refreshAccessToken(
  appId: string,
  appSecret: string,
  refreshToken: string
): Promise<AuthToken> {
  const res = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: appId,
      client_secret: appSecret,
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json() as any;

  if (data.code !== 0) {
    throw new Error(`刷新 token 失败: ${data.msg || JSON.stringify(data)}`);
  }

  const now = Date.now();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now + (data.expires_in * 1000),
    refresh_expires_at: now + (data.refresh_token_expires_in * 1000),
  };
}

/**
 * 获取有效的 user_access_token
 * - 如果 token 有效，直接返回
 * - 如果 token 过期但 refresh_token 有效，刷新后返回
 * - 如果都过期，返回 null 需要重新授权
 */
export async function getValidUserToken(
  appId: string,
  appSecret: string,
  profile?: string
): Promise<string | null> {
  const token = loadAuthToken(profile);
  if (!token) return null;

  const now = Date.now();

  // access_token 还有效（提前 5 分钟刷新）
  if (token.expires_at > now + 5 * 60 * 1000) {
    return token.access_token;
  }

  // refresh_token 还有效，尝试刷新
  if (token.refresh_expires_at > now) {
    try {
      const newToken = await refreshAccessToken(appId, appSecret, token.refresh_token);
      saveAuthToken(newToken, profile);
      return newToken.access_token;
    } catch {
      return null;
    }
  }

  // 都过期了
  return null;
}

/**
 * 执行 OAuth 授权流程
 */
export async function doOAuthFlow(
  appId: string,
  appSecret: string,
  profile?: string
): Promise<string> {
  console.log("\n🔐 需要授权访问您的云文档");
  console.log("请在浏览器中打开以下链接进行授权：\n");
  console.log(generateAuthUrl(appId, "larkcc"));
  console.log("\n等待授权...");

  // 等待回调
  const code = await waitForCallback();
  console.log("✅ 已获取授权码，正在换取 token...");

  // 换取 token
  const token = await exchangeCodeForToken(appId, appSecret, code);
  saveAuthToken(token, profile);
  console.log("✅ 授权成功！\n");

  return token.access_token;
}
