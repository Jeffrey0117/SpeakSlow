// 桌面版登入流程。
//
// LetMeUse 的 SDK 是瀏覽器用的（script tag + 彈窗），桌面 app 不能直接嵌。
// 作法是 OAuth 風格的回跳：本機開一個只聽 127.0.0.1 的臨時伺服器 → 用系統瀏覽器
// 打開登入頁並帶上回跳網址 → 使用者在瀏覽器登入 → 瀏覽器把 token 丟回本機 →
// 伺服器立刻關掉。token 存進本機設定，之後上傳統計時當 Bearer 用。
//
// 安全考量：
// - 只綁 127.0.0.1，外部連不到
// - 用隨機 state 比對，擋掉別的網頁亂打我們的 port 塞假 token
// - 90 秒沒完成就自動收掉，不留著一個開著的 port

const http = require("node:http");
const crypto = require("node:crypto");

const LOGIN_TIMEOUT = 90 * 1000;

function htmlResponse(ok) {
  const msg = ok ? "登入成功，可以關掉這個分頁了" : "登入失敗，請回到聲聲慢再試一次";
  return `<!doctype html><meta charset="utf-8"><title>聲聲慢</title>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#fff">
<div style="text-align:center"><div style="font-size:48px">${ok ? "✅" : "⚠️"}</div>
<p style="font-size:18px">${msg}</p></div>`;
}

/**
 * 啟動一次登入流程。
 * @param {{baseUrl: string, shell: object, logger?: object}} deps
 * @returns {Promise<{token: string, name?: string, email?: string}>}
 */
function startLogin({ baseUrl, shell, logger }) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString("hex");
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch (e) { /* ignore */ }
      err ? reject(err) : resolve(value);
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      // state 不符＝不是我們發起的那次登入，直接忽略
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(htmlResponse(false));
        return;
      }
      const token = url.searchParams.get("token");
      res.writeHead(token ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        .end(htmlResponse(!!token));
      if (token) {
        finish(null, {
          token,
          name: url.searchParams.get("name") || "",
          email: url.searchParams.get("email") || "",
        });
      } else {
        finish(new Error("沒有取得登入憑證"));
      }
    });

    const timer = setTimeout(() => finish(new Error("登入逾時")), LOGIN_TIMEOUT);

    server.on("error", (e) => finish(e));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const loginUrl = `${baseUrl.replace(/\/$/, "")}/desktop-login?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
      logger?.info?.("開啟瀏覽器登入", { port });
      try {
        shell.openExternal(loginUrl);
      } catch (e) {
        finish(e);
      }
    });
  });
}

module.exports = { startLogin, LOGIN_TIMEOUT };
