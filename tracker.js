"use strict";
var mediaTools = require("./media.js");

function Tracker(options) {
  this.options = options || {};
  this.media = null;
  this.last = null;
  this.lastSent = 0;
  this.watchedSeconds = 0;
  this.completed = false;
  this.watchedAt = null;
}
Tracker.prototype.select = function (media) {
  this.media = media;
  this.last = null;
  this.lastSent = 0;
  this.watchedSeconds = 0;
  this.completed = false;
  this.watchedAt = null;
};
Tracker.prototype.sample = function (sample, force) {
  if (!this.media || !Number.isFinite(sample.duration) || sample.duration <= 0 || !Number.isFinite(sample.position)) return null;
  sample.position = Math.max(0, Math.min(sample.duration, sample.position));
  var previous = this.last;
  if (previous && !previous.paused) {
    var elapsed = Math.max(0, Math.min(5, sample.now - previous.now));
    var delta = sample.position - previous.position;
    // Seeking, buffering and system sleep do not count as time watched.
    if (delta > 0 && delta <= elapsed * Math.max(1, sample.speed || 1) + 2) this.watchedSeconds += elapsed;
  }
  this.last = Object.assign({}, sample);
  if (this.completed) return null;
  var progress = sample.position / sample.duration * 100;
  var threshold = Number(this.options.threshold) || 80;
  var minimum = Math.min(Number(this.options.minimum) || 60, sample.duration * 0.5);
  var record = mediaTools.record(this.media, sample.duration);
  if (progress >= threshold && this.watchedSeconds >= minimum) {
    this.completed = true;
    this.watchedAt = new Date(sample.now * 1000).toISOString();
    return { kind: "history", record: record, watched_at: this.watchedAt };
  }
  var changed = previous && previous.paused !== sample.paused;
  if (progress > 0 && (force || !previous || changed || sample.now - this.lastSent >= 30)) {
    this.lastSent = sample.now;
    return { kind: "progress", record: record, progress: Math.min(99, Math.max(0.01, progress)) };
  }
  return null;
};
module.exports = { Tracker: Tracker };
