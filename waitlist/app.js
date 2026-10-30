/* =====================================================================
 * 海大餐廳候位系統 前端共用程式（顧客端 index.html 與員工端 staff.html 共用）
 *
 * 架構：GitHub Pages（這些靜態網頁） ──fetch──► Google Apps Script 網頁應用程式（Code.gs）
 *                                               ├─ 自己寫的 Queue（JSON 陣列存在 PropertiesService，不用試算表、不用資料庫）
 *                                               └─ MailApp = 用你的 Gmail 寄候位通知
 *
 * 部署好 Apps Script（見作業說明）之後，把網址貼到下面的 API_URL。
 * API_URL 留空時為「示範模式」：資料只存在這台瀏覽器的 localStorage，
 * 可以先測試畫面與流程，但不會跨裝置、也不會真的寄信。
 * ===================================================================== */
const API_URL = "https://script.google.com/macros/s/AKfycbwFe8BSzDTMEgMFDJ08u91bqFE6mDELOozvjZH-8V5YpCbZJ4P8HeTuWF9r80gp-PIF/exec";
const RESTAURANT = "海大餐廳";
const DEMO_STAFF_KEY = "staff";   // 示範模式的員工密碼（正式模式的密碼寫在 Code.gs 的 STAFF_KEY）

const ACTIVE = ["waiting", "notified"];
const STATUS_TEXT = { waiting: "等候中", notified: "已通知，請至櫃台報到", seated: "已入座", cancelled: "已取消" };

/* ---------- 示範模式：前端自己用 localStorage 跑一個一樣的 Queue（和 Code.gs 的邏輯相同） ---------- */
const Local = {
  queueKey: "waitlist_demo_queue",
  nextIdKey: "waitlist_demo_next_id",
  statsKey: "waitlist_demo_stats",
  logKey: "waitlist_demo_log",
  load() {
    try {
      const saved = localStorage.getItem(this.queueKey);
      if (saved !== null) return JSON.parse(saved);

      // 舊示範資料曾把已取消/入座項目留在同一陣列；遷移時只保留仍候位的項目。
      const oldRows = JSON.parse(localStorage.getItem("waitlist_demo") || "[]");
      const active = oldRows.filter(r => ACTIVE.includes(r.status));
      localStorage.setItem(this.queueKey, JSON.stringify(active));
      const nextId = oldRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      localStorage.setItem(this.nextIdKey, String(nextId));
      const today = this.now().slice(0, 10);
      const stats = {
        date: today,
        seated: oldRows.filter(r => r.status === "seated" && String(r.closed_at).startsWith(today)).length,
        cancelled: oldRows.filter(r => r.status === "cancelled" && String(r.closed_at).startsWith(today)).length
      };
      localStorage.setItem(this.statsKey, JSON.stringify(stats));
      localStorage.removeItem("waitlist_demo");
      return active;
    } catch (e) { return []; }
  },
  save(rows) { try { localStorage.setItem(this.queueKey, JSON.stringify(rows)); } catch (e) {} },
  now() {
    const d = new Date(), z = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
  },
  stats() {
    const today = this.now().slice(0, 10);
    try {
      const saved = JSON.parse(localStorage.getItem(this.statsKey) || "null");
      if (saved && saved.date === today) return saved;
    } catch (e) {}
    const fresh = { date: today, seated: 0, cancelled: 0 };
    try { localStorage.setItem(this.statsKey, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  },
  addStat(reason) {
    const stats = this.stats();
    stats[reason]++;
    try { localStorage.setItem(this.statsKey, JSON.stringify(stats)); } catch (e) {}
  },
  addLog(event, detail) {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem(this.logKey) || "[]"); } catch (e) {}
    entries.push(this.now() + " | " + event + " | " + detail);
    try { localStorage.setItem(this.logKey, JSON.stringify(entries.slice(-40))); } catch (e) {}
  },
  handle(action, p) {
    const queue = this.load();
    const findIndex = () => queue.findIndex(r => String(r.id) === String(p.id));
    const staff = () => p.key === DEMO_STAFF_KEY;
    switch (action) {
      case "count": return { waiting: queue.length };
      case "status": {
        const i = findIndex();
        if (i < 0) return { error: "找不到這個候位號碼（可能已入座或取消）" };
        return { ...queue[i], ahead: i, waiting: queue.length };
      }
      case "join": {
        if (!p.name || !p.email || String(p.email).indexOf("@") < 0) return { error: "請填寫姓名與正確的 E-mail" };
        if (queue.length >= 500) return { error: "候位已滿，請稍後再試" };
        const id = Number(localStorage.getItem(this.nextIdKey) || "1");
        const item = { id, name: String(p.name).trim(), gender: p.gender || "其他", email: String(p.email).trim(),
                       party_size: Number(p.party_size) || 1, status: "waiting", created_at: this.now(), notified_at: "" };
        queue.push(item);
        this.save(queue);
        try { localStorage.setItem(this.nextIdKey, String(id + 1)); } catch (e) {}
        this.addLog("候位", id + " 號 " + item.name);
        return { id, ahead: queue.length - 1 };
      }
      case "leave": {
        const i = findIndex();
        if (i >= 0) {
          const [r] = queue.splice(i, 1);
          this.save(queue); this.addStat("cancelled"); this.addLog("顧客取消", r.id + " 號");
        }
        return { ok: true };
      }
      case "queue": {
        if (!staff()) return { error: "unauthorized" };
        const stats = this.stats();
        return { queue, seated: stats.seated, cancelled: stats.cancelled };
      }
      case "notify": {
        if (!staff()) return { error: "unauthorized" };
        const i = findIndex(); if (i < 0) return { error: "找不到這個候位號碼" };
        const r = queue[i];
        r.status = "notified"; r.notified_at = this.now(); this.save(queue);
        this.addLog("通知", r.id + " 號 " + r.name + " → " + r.email);
        return { ok: true, detail: "示範模式：狀態已改為已通知，但沒有真的寄信（設定 API_URL 後才會透過 Gmail 寄出）" };
      }
      case "seat": case "cancel": {
        if (!staff()) return { error: "unauthorized" };
        const i = findIndex(); if (i < 0) return { error: "找不到這個候位號碼" };
        const [r] = queue.splice(i, 1);
        const reason = action === "seat" ? "seated" : "cancelled";
        this.save(queue); this.addStat(reason);
        this.addLog(action === "seat" ? "入座" : "員工取消", r.id + " 號");
        return { ok: true };
      }
      case "log": {
        if (!staff()) return { error: "unauthorized" };
        let log = [];
        try { log = JSON.parse(localStorage.getItem(this.logKey) || "[]"); } catch (e) {}
        return { log };
      }
      case "reset": {
        if (!staff()) return { error: "unauthorized" };
        [this.queueKey, this.nextIdKey, this.statsKey, this.logKey, "waitlist_demo"].forEach(k => {
          try { localStorage.removeItem(k); } catch (e) {}
        });
        return { ok: true };
      }
    }
    return { error: "unknown action " + action };
  }
};

/* ---------- 呼叫後端 ---------- */
const POST_ACTIONS = ["join", "leave", "notify", "seat", "cancel"];

async function api(action, params = {}) {
  if (!API_URL) return Local.handle(action, params);
  let res;
  if (POST_ACTIONS.includes(action)) {
    // 不設定 Content-Type，瀏覽器會用 text/plain，才不會觸發 Apps Script 不支援的 CORS preflight
    res = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action, ...params }) });
  } else {
    res = await fetch(API_URL + "?" + new URLSearchParams({ action, ...params }));
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function isDemo() { return !API_URL; }

function showDemoBanner() {
  if (!isDemo()) return;
  const el = document.getElementById("demo-banner");
  if (el) el.hidden = false;
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
