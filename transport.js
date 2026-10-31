"use strict";

// IINA's built-in HTTP API form-encodes its data argument. CrossWatch requires JSON.
// Use macOS curl directly, with credentials in a private temporary directory, not argv.
function createTransport(runtime) {
  async function request(method, url, options) {
    var temporary = await runtime.utils.exec("/usr/bin/mktemp", ["-d", "-t", "iina-crosswatch"]);
    var directory = String(temporary.stdout || "").trim();
    if (temporary.status !== 0 || !/^\/(?:private\/)?(?:var\/folders\/|tmp\/).+\/iina-crosswatch\.[a-zA-Z0-9]+$/.test(directory)) {
      throw new Error("Cannot create a private request directory.");
    }
    var headerPath = directory + "/headers";
    var bodyPath = directory + "/body";
    try {
      var headers = Object.keys(options.headers || {}).map(function (name) {
        var value = String(options.headers[name]);
        if (/[\r\n]/.test(value)) throw new Error("Invalid header.");
        return name + ": " + value;
      });
      headers.push("Content-Type: application/json");
      runtime.file.write(headerPath, headers.join("\n") + "\n");
      var args = ["-q", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "30",
        "--proto", "=https", "--request", method, "--header", "@" + headerPath,
        "--write-out", "\n__CW_STATUS__:%{http_code}", "--url", url];
      if (options.data !== undefined) {
        runtime.file.write(bodyPath, JSON.stringify(options.data));
        args.push("--data-binary", "@" + bodyPath);
      }
      var response = await runtime.utils.exec("/usr/bin/curl", args);
      if (response.status !== 0) throw new Error("Network request failed.");
      var text = String(response.stdout || "");
      var marker = text.lastIndexOf("\n__CW_STATUS__:");
      if (marker < 0) throw new Error("Invalid response.");
      return { statusCode: Number(text.slice(marker + 15)), text: text.slice(0, marker) };
    } finally {
      try { runtime.file.delete(headerPath); } catch (_) {}
      try { runtime.file.delete(bodyPath); } catch (_) {}
      try { await runtime.utils.exec("/bin/rmdir", [directory]); } catch (_) {}
    }
  }
  return { get: function (url, options) { return request("GET", url, options); },
    post: function (url, options) { return request("POST", url, options); } };
}
module.exports = { createTransport: createTransport };
