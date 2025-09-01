// IAI-focused Memory Probe: visits up to N .fs-iai, waits for render,
// adds a random delay between ads, idles at the last ad, then summarizes.
(async function iaiMemProbe({
  label = 'baseline',
  maxAds = 5,                   // how many .fs-iai to visit
  perAdTimeoutMs = 20000,       // max wait per ad to detect load
  settleAfterLoadMs = 1500,     // small delay after load to stabilize
  minDelayBetweenAdsMs = 10000, // minimum random wait after an ad appears (15s)
  maxDelayBetweenAdsMs = 15000, // maximum random wait after an ad appears (25s)
  idleAfterLastMs = 90000,      // idle at the last ad to allow refresh (~1.5min)
  sampleEveryMs = 1000,         // background sampler (for peaks)
  scrollBehavior = 'smooth'     // or 'auto' if you want faster scrolls
} = {}) {
  const supportsUA   = !!performance.measureUserAgentSpecificMemory;
  const supportsHeap = !!(performance.memory && 'usedJSHeapSize' in performance.memory);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nowISO = () => new Date().toISOString();
  const randBetween = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

  const getDOMCount = () => document.getElementsByTagName('*').length;
  const fmt = b => (b == null ? null :
    (b >= 1024*1024 ? `${(b/1024/1024).toFixed(1)} MB` :
     b >= 1024 ? `${(b/1024).toFixed(1)} KB` : `${b} B`));

  function getSlot(el) {
    return el?.querySelector('[id$="_slot"]') || null;
  }
  function isSlotLoaded(el) {
    const s = getSlot(el);
    return !!(s && s.children && s.children.length > 0);
  }
  function distanceFromViewport(el) {
    const rect = el.getBoundingClientRect();
    return Math.round((rect.top - window.innerHeight) / window.innerHeight * 100);
  }
  async function getMem() {
    const heap = supportsHeap ? performance.memory.usedJSHeapSize : null;
    let uaBytes = null;
    if (supportsUA) {
      try {
        uaBytes = (await performance.measureUserAgentSpecificMemory())?.bytes ?? null;
      } catch {}
    }
    return { heap, uaBytes };
  }
  async function scrollIntoViewAndWait(el) {
    el.scrollIntoView({ block: 'center', behavior: scrollBehavior });
    await sleep(400); // allow layout/IO settle
  }
  async function waitForAdLoad(el, timeoutMs) {
    const t0 = performance.now();
    if (isSlotLoaded(el)) return { loaded: true, timeToLoadMs: 0 };
    return new Promise(resolve => {
      let done = false;
      const finish = (loaded) => {
        if (done) return;
        done = true;
        resolve({ loaded, timeToLoadMs: Math.round(performance.now() - t0) });
      };
      const iv = setInterval(() => {
        if (isSlotLoaded(el)) { clearInterval(iv); clearTimeout(to); finish(true); }
      }, 250);
      const to = setTimeout(() => {
        clearInterval(iv);
        finish(false);
      }, timeoutMs);
    });
  }

  const slots = Array.from(document.querySelectorAll('.fs-iai'));
  if (!slots.length) {
    console.warn('No .fs-iai elements found.');
  }
  const targetSlots = slots.slice(0, maxAds);

  // Start background sampler for peaks
  const samples = [];
  let sampling = true;
  (async () => {
    while (sampling) {
      const m = await getMem();
      samples.push({ tsISO: nowISO(), t: performance.now(), dom: getDOMCount(), ...m });
      await sleep(sampleEveryMs);
    }
  })();

  const startDom = getDOMCount();
  const startMem = await getMem();

  const adResults = [];
  for (let i = 0; i < targetSlots.length; i++) {
    const el = targetSlots[i];
    await scrollIntoViewAndWait(el);

    const dist = distanceFromViewport(el);
    const before = await getMem();
    const tStart = performance.now();

    const { loaded, timeToLoadMs } = await waitForAdLoad(el, perAdTimeoutMs);
    if (loaded) await sleep(settleAfterLoadMs);

    const after = await getMem();
    adResults.push({
      index: i,
      id: el.id || null,
      distFromViewportPct: dist,
      tsISO: nowISO(),
      loaded,
      timeToLoadMs,
      mem_before_heap: before.heap,
      mem_after_heap: after.heap,
      mem_before_uaBytes: before.uaBytes,
      mem_after_uaBytes: after.uaBytes,
      dom_after: getDOMCount(),
      durationMs: Math.round(performance.now() - tStart)
    });

    // Random wait before moving to next ad
    if (i < targetSlots.length - 1) {
      const delay = randBetween(minDelayBetweenAdsMs, maxDelayBetweenAdsMs);
      console.log(`⏳ Waiting ${Math.round(delay/1000)}s before next ad...`);
      await sleep(delay);
    }
  }

  // Idle at last ad (refresh window)
  if (targetSlots.length) {
    targetSlots[targetSlots.length - 1].scrollIntoView({ block: 'center', behavior: scrollBehavior });
  }
  await sleep(idleAfterLastMs);

  sampling = false;
  await sleep(sampleEveryMs + 20);

  const endDom = getDOMCount();
  const endMem = await getMem();

  // Peak computations
  const heaps = samples.map(s => s.heap).filter(v => Number.isFinite(v));
  const uaAll = samples.map(s => s.uaBytes).filter(v => Number.isFinite(v));
  const peakHeap = heaps.length ? Math.max(...heaps) : null;
  const peakUA   = uaAll.length ? Math.max(...uaAll) : null;

  const result = {
    label,
    url: location.href,
    tsISO: nowISO(),
    nav: { ua: navigator.userAgent, width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    params: { maxAds, perAdTimeoutMs, settleAfterLoadMs, idleAfterLastMs, sampleEveryMs },
    dom: { start: startDom, end: endDom, delta: endDom - startDom },
    heap_bytes: { start: startMem.heap, end: endMem.heap, peak_during_run: peakHeap },
    ua_specific_bytes: { start: startMem.uaBytes, end: endMem.uaBytes, peak_during_run: peakUA },
    ads: {
      totalFound: slots.length,
      tested: targetSlots.length,
      loadedCount: adResults.filter(r => r.loaded).length,
      items: adResults
    },
    pretty: {
      heap: { start: fmt(startMem.heap), end: fmt(endMem.heap), peak: fmt(peakHeap) },
      uaSpecific: { start: fmt(startMem.uaBytes), end: fmt(endMem.uaBytes), peak: fmt(peakUA) }
    }
  };

  // Console overview
  console.table({
    label: result.label,
    'DOM start→end': `${startDom} → ${endDom} (${result.dom.delta >= 0 ? '+' : ''}${result.dom.delta})`,
    'Heap start': result.pretty.heap.start,
    'Heap peak': result.pretty.heap.peak,
    'Heap end': result.pretty.heap.end,
    'UA start': result.pretty.uaSpecific.start,
    'UA peak': result.pretty.uaSpecific.peak,
    'UA end': result.pretty.uaSpecific.end,
    'IAI tested / found': `${result.ads.tested} / ${result.ads.totalFound}`,
    'IAI loaded (of tested)': `${result.ads.loadedCount}`
  });

  console.table(result.ads.items.map(r => ({
    idx: r.index,
    id: r.id,
    distPct: r.distFromViewportPct,
    loaded: r.loaded,
    tLoadMs: r.timeToLoadMs,
    heap_before: fmt(r.mem_before_heap),
    heap_after: fmt(r.mem_after_heap),
    ua_before: fmt(r.mem_before_uaBytes),
    ua_after: fmt(r.mem_after_uaBytes),
    dom_after: r.dom_after,
    durMs: r.durationMs
  })));

  console.log('IAI_MEM_PROBE_JSON_START');
  console.log(JSON.stringify(result, null, 2));
  console.log('IAI_MEM_PROBE_JSON_END');
  return result;
})();
