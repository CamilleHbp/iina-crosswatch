"use strict";
var mediaTools = require("./media.js");
var clientTools = require("./client.js");
var Tracker = require("./tracker.js").Tracker;
var transport = require("./transport.js").createTransport(iina);
var preferences = iina.preferences;
var state = { status: "Open a movie or episode to begin.", file: "", parsed: null, media: null, results: [], progress: 0 };
var tracker = new Tracker();
var generation = 0;
var busy = false;
var retryAt = 0;
var retryCount = 0;
var sidebarReady = false;
var sidebarInitialized = false;
var session = Date.now().toString(36) + Math.random().toString(36).slice(2);
var sequence = 0;

function setting(key, fallback) {
  var value = preferences.get(key);
  return value == null ? fallback : value;
}
function readJSON(key, fallback) {
  try { return JSON.parse(preferences.get(key) || "") || fallback; } catch (_) { return fallback; }
}
function publish(message) {
  if (message) state.status = message;
  if (sidebarReady) iina.sidebar.postMessage("state", state);
}
function client() { return clientTools.createClient(transport, clientTools.configuration(preferences)); }
function target() {
  var config = clientTools.configuration(preferences);
  return config.base + "|" + config.instance;
}
function persistPending(pending) { preferences.set("pending", JSON.stringify(pending)); preferences.sync(); }
function queue(job) {
  if (!job) return;
  try {
    var pending = readJSON("pending", {});
    var destination = target();
    // Replace only this playback session's unsent progress, never another video's history.
    Object.keys(pending).forEach(function (key) {
      if (pending[key].session === session && pending[key].kind === "progress") delete pending[key];
    });
    var id = session + "-" + (++sequence);
    pending[id] = Object.assign({ session: session, target: destination, created: Date.now() }, job);
    persistPending(pending);
    pump();
  } catch (error) { if (job.kind === "history") tracker.completed = false; publish(error.message); }
}
async function pump() {
  if (busy || !setting("enabled", true) || Date.now() < retryAt) return;
  var destination;
  try { destination = target(); } catch (_) { return; }
  var pending = readJSON("pending", {});
  var ids = Object.keys(pending).filter(function (id) { return pending[id].target === destination; })
    .sort(function (a, b) { return pending[a].created - pending[b].created; });
  if (!ids.length) return;
  var id = ids[0];
  var job = pending[id];
  busy = true;
  try {
    await client().send(job);
    // Re-read: another player may have queued work while this request was in flight.
    pending = readJSON("pending", {});
    delete pending[id];
    persistPending(pending);
    retryCount = 0;
    retryAt = 0;
    publish(job.kind === "history" ? "Watched history saved to CrossWatch." : "Playback progress saved to CrossWatch.");
  } catch (error) {
    retryCount++;
    retryAt = Date.now() + (error.retryable ? Math.min(300000, 5000 * Math.pow(2, Math.min(retryCount - 1, 6))) : 300000);
    publish(error.message + " Pending updates are saved locally. Use Retry after fixing the problem.");
    // Do not log errors supplied by the HTTP library: they can contain credentials.
    iina.console.warn("CrossWatch delivery failed; update retained for retry.");
  } finally {
    busy = false;
  }
}
function sample(force) {
  if (!state.media || !setting("enabled", true)) return;
  var duration = iina.mpv.getNumber("duration");
  var position = iina.mpv.getNumber("time-pos");
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return;
  var paused = Boolean(iina.mpv.getFlag("pause"));
  state.progress = Math.round(position / duration * 100);
  queue(tracker.sample({ duration: duration, position: position, paused: paused,
    speed: Number(iina.mpv.getNumber("speed")) || 1, now: Date.now() / 1000 }, force));
}
function finish() {
  if (state.media && tracker.last && setting("enabled", true)) {
    // mpv may already have reset time-pos to zero when end-file arrives.
    queue(tracker.sample(Object.assign({}, tracker.last, { now: Date.now() / 1000, paused: true }), true));
  }
  generation++;
  state.media = null;
  state.results = [];
  state.file = "";
  state.parsed = null;
  tracker.select(null);
  publish("Playback stopped. Pending updates will be retried automatically.");
}
function select(item, season, episode, remember) {
  var media = mediaTools.makeMedia(item, season, episode);
  state.media = media;
  tracker.options = {
    threshold: Math.max(50, Math.min(100, Number(setting("watched_threshold", 80)) || 80)),
    minimum: Math.max(1, Number(setting("minimum_watch_seconds", 60)) || 60)
  };
  tracker.select(media);
  if (remember && state.parsed) {
    var mappings = readJSON("matches", {});
    mappings[state.parsed.filename] = media;
    var keys = Object.keys(mappings);
    if (keys.length > 500) delete mappings[keys[0]];
    preferences.set("matches", JSON.stringify(mappings));
    preferences.sync();
  }
  publish("Tracking " + media.title + (media.type === "episode" ? " · S" + media.season + " E" + media.episode : "") + ".");
  sample(true);
}
async function search(query, type, year, automatic) {
  if (String(query).trim().length < 2) { publish("Enter at least two characters to search."); return; }
  var current = generation;
  publish("Looking up the title on CrossWatch…");
  try {
    var results = await client().search(String(query).trim().slice(0, 200), type, year);
    if (current !== generation) return;
    state.results = results;
    var match = automatic && state.parsed && setting("auto_match", true) ? mediaTools.chooseMatch(state.parsed, results) : null;
    if (match) select(match, state.parsed.season, state.parsed.episode, false);
    else publish(results.length ? "Select the correct title below to start tracking." : "No matches. Try another title or enter an ID.");
  } catch (error) { if (current === generation) publish(error.message); }
}
function loaded() {
  initializeSidebar();
  if (state.media) finish();
  generation++;
  session = Date.now().toString(36) + Math.random().toString(36).slice(2);
  var path = iina.mpv.getString("path") || "";
  var name = iina.mpv.getString("filename") || path;
  // Stream URLs often contain opaque filenames; prefer an explicit media title in that case.
  var title = iina.mpv.getString("media-title") || name;
  var parsed = mediaTools.parseFilename(name);
  if (/^https?:/i.test(path) && !parsed.year && parsed.season === null && title !== name) parsed = mediaTools.parseFilename(title);
  state.parsed = parsed;
  state.file = parsed.filename;
  state.results = [];
  state.progress = 0;
  state.media = null;
  tracker.select(null);
  if (!setting("enabled", true)) { publish("Scrobbling is disabled in plugin preferences."); return; }
  var remembered = readJSON("matches", {})[parsed.filename];
  if (remembered) {
    select({ type: remembered.type === "episode" ? "show" : "movie", title: remembered.title,
      year: remembered.year, tmdb: remembered.ids.tmdb, imdb: remembered.ids.imdb }, remembered.season, remembered.episode, false);
  } else if (parsed.imdb && !parsed.multi) {
    select({ type: parsed.type, imdb: parsed.imdb, title: parsed.title, year: parsed.year }, parsed.season, parsed.episode, false);
  } else {
    search(parsed.title, parsed.type, parsed.year, true);
  }
}

function initializeSidebar() {
  if (sidebarInitialized) return;
  iina.sidebar.loadFile("sidebar.html");
  sidebarInitialized = true;

iina.sidebar.onMessage("ready", function () { sidebarReady = true; publish(); });
iina.sidebar.onMessage("search", function (data) {
  if (!state.file) { publish("Open a video first."); return; }
  search(data.query || "", data.type, Number(data.year) || null, false);
});
iina.sidebar.onMessage("select", function (data) {
  if (!state.file) return;
  try {
    var item = state.results[Number(data.index)];
    if (!item) throw new Error("Search again to choose a title.");
    select(item, data.season, data.episode, true);
  } catch (error) { publish(error.message); }
});
iina.sidebar.onMessage("manual", function (data) {
  if (!state.file) return;
  try {
    var id = String(data.id || "").trim();
    select({ type: data.type, title: data.title || state.parsed.title,
      tmdb: /^\d+$/.test(id) ? id : null, imdb: /^tt/.test(id) ? id : null }, data.season, data.episode, true);
  } catch (error) { publish(error.message); }
});
iina.sidebar.onMessage("retry", function () { retryAt = 0; retryCount = 0; pump(); });
iina.sidebar.onMessage("check", async function () {
  try { await client().check(); publish("Connected to CrossWatch. API token accepted."); }
  catch (error) { publish(error.message); }
});
iina.sidebar.onMessage("skip", function () {
  generation++;
  tracker.select(null);
  state.media = null;
  publish("Tracking stopped for this file.");
});
}
iina.menu.addItem(iina.menu.item("CrossWatch", function () { initializeSidebar(); iina.sidebar.show(); }));
iina.menu.addItem(iina.menu.item("Check CrossWatch connection", async function () {
  try { await client().check(); publish("Connected to CrossWatch. API token accepted."); iina.core.osd("CrossWatch connected"); }
  catch (error) { publish(error.message); iina.core.osd(error.message); }
}));
iina.menu.addItem(iina.menu.item("Identify video by ID…", function () {
  if (!state.file) { loaded(); }
  if (!state.file) return;
  var id = iina.utils.prompt("CrossWatch: enter a movie or series IMDb ID (tt…) or TMDb number");
  if (!id) return;
  var episode = iina.utils.prompt("Episode: enter S01E02, or leave blank for a movie");
  if (episode === null || episode === undefined) return;
  var parts = /^S(\d+)E(\d+)$/i.exec(String(episode).trim());
  if (String(episode).trim() && !parts) { iina.core.osd("Use S01E02, or leave blank for a movie."); return; }
  try {
    id = String(id).trim();
    select({type:parts ? "show" : "movie", title:state.parsed.title,
      tmdb:/^\d+$/.test(id) ? id : null, imdb:/^tt/.test(id) ? id : null}, parts ? parts[1] : null, parts ? parts[2] : null, true);
    iina.core.osd("CrossWatch: tracking " + state.media.title);
  } catch (error) { iina.core.osd(error.message); }
}));
iina.event.on("iina.window-loaded", initializeSidebar);
iina.event.on("iina.file-loaded", loaded);
iina.event.on("mpv.pause.changed", function () { sample(true); });
iina.event.on("mpv.end-file", finish);
iina.event.on("iina.window-will-close", finish);
setInterval(function () {
  try { sample(false); pump(); publish(); }
  catch (_) { publish("Unable to read playback state."); }
}, 1000);
iina.console.log("CrossWatch Scrobbler 1.0.0 loaded (direct tracker API).");
