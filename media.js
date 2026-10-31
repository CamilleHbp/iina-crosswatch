"use strict";

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseFilename(value) {
  // Never use URL query strings (which often contain credentials) as search input.
  var leaf = String(value || "").split(/[?#]/)[0].split(/[\\/]/).pop();
  try { leaf = decodeURIComponent(leaf); } catch (_) {}
  leaf = leaf.replace(/\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv)$/i, "");
  var episode = /\bS(\d{1,2})[ ._-]*E(\d{1,3})(?!\d)/i.exec(leaf) || /\b(\d{1,2})x(\d{1,3})(?!\d)/i.exec(leaf);
  // Multi-episode files need an explicit selection instead of guessing the first episode.
  var multi = episode && /^(?:[ ._-]*E\d|[ ._-]*-\d)/i.test(leaf.slice(episode.index + episode[0].length));
  var prefix = episode ? leaf.slice(0, episode.index) : leaf;
  var yearMatch = /(?:^|[ ._(\[])(19\d{2}|20\d{2})(?=$|[ ._)\]])/.exec(prefix);
  var title = yearMatch ? prefix.slice(0, yearMatch.index) : prefix;
  title = title.replace(/\b(?:480p|720p|1080p|2160p|4k|bluray|bdrip|webrip|web[ ._-]?dl|hdtv|x264|x265|hevc)\b.*$/i, "")
    .replace(/\[(?:imdb[- :=]*)?tt\d+\]|\{(?:imdb[- :=]*)?tt\d+\}/ig, "")
    .replace(/[._]+/g, " ").replace(/[\s\-([\]]+$/g, "").trim();
  var imdb = /\btt\d{7,10}\b/.exec(leaf);
  return { title: title, year: yearMatch ? Number(yearMatch[1]) : null,
    type: episode ? "show" : "movie", season: episode ? Number(episode[1]) : null,
    episode: episode ? Number(episode[2]) : null, multi: Boolean(multi),
    imdb: imdb ? imdb[0] : null, filename: leaf };
}

function chooseMatch(parsed, results) {
  if (parsed.multi) return null;
  // A year is required for automatic movie matches. Series names must be unique.
  if (parsed.type === "movie" && !parsed.year) return null;
  var matches = results.filter(function (item) {
    return item.type === parsed.type && normalize(item.title) === normalize(parsed.title) &&
      (!parsed.year || Number(item.year) === parsed.year);
  });
  return matches.length === 1 ? matches[0] : null;
}

function makeMedia(item, season, episode) {
  var ids = {};
  if (/^[1-9]\d*$/.test(String(item.tmdb || ""))) ids.tmdb = String(item.tmdb);
  if (/^tt\d{7,10}$/.test(String(item.imdb || ""))) ids.imdb = item.imdb;
  if (!Object.keys(ids).length) throw new Error("Enter a valid TMDb or IMDb ID.");
  var isEpisode = item.type === "show";
  if (isEpisode && (!Number.isInteger(Number(season)) || Number(season) < 0 ||
      !Number.isInteger(Number(episode)) || Number(episode) < 1 || season === "" || episode === "" || season == null || episode == null)) {
    throw new Error("Enter a season (0 or higher) and episode (1 or higher).");
  }
  return { type: isEpisode ? "episode" : "movie", title: String(item.title || "Untitled"),
    year: item.year || null, ids: ids, season: isEpisode ? Number(season) : null,
    episode: isEpisode ? Number(episode) : null };
}

function record(media, duration) {
  var result = { media_type: media.type, title: media.title, year: media.year,
    ids: media.type === "episode" ? {} : media.ids,
    duration_seconds: Math.round(duration), can_update_progress: true };
  if (media.type === "episode") {
    result.series_title = media.title;
    result.season = media.season;
    result.episode = media.episode;
    result.provider_metadata = { show_ids: media.ids };
  }
  return result;
}

module.exports = { normalize: normalize, parseFilename: parseFilename, chooseMatch: chooseMatch,
  makeMedia: makeMedia, record: record };
