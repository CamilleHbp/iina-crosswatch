"use strict";

function configuration(preferences) {
  var base = String(preferences.get("server_url") || "").trim().replace(/\/+$/, "");
  // Only HTTPS; no credentials, fragments or query strings in the server address.
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._~-]+)*$/i.test(base)) {
    throw new Error("Set your HTTPS CrossWatch server URL in plugin preferences.");
  }
  var token = String(preferences.get("api_token") || "").trim();
  if (!token || /[\r\n]/.test(token)) throw new Error("Set your CrossWatch API token in plugin preferences.");
  return { base: base, token: token, instance: String(preferences.get("instance_id") || "default").trim() };
}

function createClient(http, config) {
  async function request(method, path, data) {
    var options = { headers: { "Authorization": "Bearer " + config.token, "Accept": "application/json" } };
    if (data !== undefined) options.data = data;
    var response;
    try { response = await http[method](config.base + path, options); }
    catch (_) { var offline = new Error("Cannot reach CrossWatch. Check your connection."); offline.retryable = true; throw offline; }
    var status = Number(response.statusCode);
    var body;
    try { body = response.data || JSON.parse(response.text); } catch (_) { body = null; }
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = null; } }
    if (!(status >= 200 && status < 300) || !body || body.ok !== true) {
      var message = status === 401 || status === 403 ? "CrossWatch rejected the API token or tracker access." :
        "CrossWatch request failed" + (status ? " (HTTP " + status + ")" : "") + ".";
      if (body && typeof body.error === "string" && body.error === "TMDb key missing") message = "Configure a TMDb key on CrossWatch, or enter an ID manually.";
      var error = new Error(message);
      error.retryable = status === 429 || status >= 500 || Boolean(body && body.retryable);
      throw error;
    }
    return body;
  }
  return {
    check: function () { return request("get", "/api/app-auth/tokens/whoami"); },
    search: async function (query, type, year) {
      var path = "/api/metadata/search?q=" + encodeURIComponent(query) + "&typ=" + (type === "show" ? "show" : "movie") + "&limit=20";
      if (year) path += "&year=" + encodeURIComponent(year);
      return (await request("get", path)).results || [];
    },
    send: function (job) {
      var body = { provider: "crosswatch", instance_id: config.instance, record: job.record };
      if (job.kind === "history") body.watched_at = job.watched_at;
      else body.progress_percent = job.progress;
      return request("post", "/api/playback_progress/actions/" + (job.kind === "history" ? "mark_watched" : "update_progress"), body);
    }
  };
}
module.exports = { configuration: configuration, createClient: createClient };
