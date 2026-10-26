// ==UserScript==
// @name         Twitch: Never Mute
// @namespace    https://tampermonkey.net/
// @version      1.3
// @description  Keeps the Twitch player unmuted, including in background tabs (Firefox/Zen friendly)
// @match        https://www.twitch.tv/*
// @match        https://player.twitch.tv/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const NEVER_MUTE = true;   // true = the player can never be muted, even by you
  const DEBUG = true;        // logs to the F12 console; set to false once it works
  const FALLBACK_VOLUME = 0.5;

  console.log('[antimute] script loaded, NEVER_MUTE =', NEVER_MUTE);

  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
  const isReallyHidden = () => realHidden.call(document);

  // 1) Spoof the Page Visibility API.
  const define = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (e) {}
  };
  define(document, 'hidden', () => false);
  define(document, 'webkitHidden', () => false);
  define(document, 'mozHidden', () => false);
  define(document, 'visibilityState', () => 'visible');
  define(document, 'webkitVisibilityState', () => 'visible');
  document.hasFocus = () => true;

  const block = (e) => e.stopImmediatePropagation();
  ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange'].forEach((ev) => {
    document.addEventListener(ev, block, true);
    window.addEventListener(ev, block, true);
  });
  window.addEventListener('blur', block, true);
  document.addEventListener('blur', block, true);

  // 2) Decide when to protect the player.
  let userMuted = false;
  let lastVolume = FALLBACK_VOLUME;
  const shouldProtect = () => NEVER_MUTE || (isReallyHidden() && !userMuted);

  const proto = HTMLMediaElement.prototype;
  const mutedDesc = Object.getOwnPropertyDescriptor(proto, 'muted');
  const volDesc = Object.getOwnPropertyDescriptor(proto, 'volume');

  const fix = (v) => {
    if (!(v instanceof HTMLVideoElement) || !shouldProtect()) return;
    if (mutedDesc.get.call(v)) {
      if (DEBUG) console.log('[antimute] unmuted video');
      mutedDesc.set.call(v, false);
    }
    if (volDesc.get.call(v) === 0) volDesc.set.call(v, lastVolume);
  };

  // 3) Block programmatic muting/zeroing.
  Object.defineProperty(proto, 'muted', {
    configurable: true,
    enumerable: mutedDesc.enumerable,
    get() { return mutedDesc.get.call(this); },
    set(val) {
      if (val && this instanceof HTMLVideoElement && shouldProtect()) {
        if (DEBUG) console.log('[antimute] blocked mute attempt', new Error().stack);
        return;
      }
      mutedDesc.set.call(this, val);
    }
  });

  Object.defineProperty(proto, 'volume', {
    configurable: true,
    enumerable: volDesc.enumerable,
    get() { return volDesc.get.call(this); },
    set(val) {
      if (Number(val) === 0 && this instanceof HTMLVideoElement && shouldProtect()) {
        if (DEBUG) console.log('[antimute] blocked volume 0', new Error().stack);
        return;
      }
      if (Number(val) > 0 && this instanceof HTMLVideoElement) lastVolume = Number(val);
      volDesc.set.call(this, val);
    }
  });

  // 4) Track state and catch anything that slipped past the setters.
  document.addEventListener('volumechange', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (!isReallyHidden() && !NEVER_MUTE) {
      userMuted = v.muted || v.volume === 0;
    }
    if (!v.muted && v.volume > 0) lastVolume = v.volume;
    fix(v);
  }, true);

  // 5) Watchdog for re-created video elements (ads, buffering resets, autoplay mutes).
  ['loadstart', 'loadedmetadata', 'playing', 'canplay'].forEach((ev) =>
    document.addEventListener(ev, (e) => fix(e.target), true)
  );
  setInterval(() => document.querySelectorAll('video').forEach(fix), 1000);

  // 6) Resume if Twitch pauses the video in the background.
  document.addEventListener('pause', (e) => {
    const v = e.target;
    if (v instanceof HTMLVideoElement && isReallyHidden() && !v.ended) {
      v.play().catch(() => {});
    }
  }, true);
})();
