#!/usr/bin/env node
/**
 * Metrics: Unique bidder sets (IDs only) and Unique bidder configs/fingerprints (IDs + params).
 * Cohort identity = Country|Domain|Device (ordered).
 *
 * Usage: node metrics.uniqueBidderSetsAndConfigs.js path/to/config.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadJson(filePath) {
  const p = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function hash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex').slice(0, 16);
}

function asKey(country, domain, device) {
  return `${country}|${domain}|${device}`;
}

function gatherBiddersFromNode(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) gatherBiddersFromNode(item, out);
    return;
  }
  if (Array.isArray(node.bidders)) {
    for (const b of node.bidders) {
      if (b) out.push(b);
    }
  }
  for (const k of Object.keys(node)) {
    if (k === 'bidders') continue;
    gatherBiddersFromNode(node[k], out);
  }
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node metrics.uniqueBidderSetsAndConfigs.js <config.json>');
    process.exit(1);
  }

  const cfg = loadJson(filePath);
  const root = cfg?.defaultConfig;
  if (!root || typeof root !== 'object') {
    throw new Error('Unexpected JSON shape: missing "defaultConfig" object.');
  }

  const cohortResults = [];
  const setKeys = new Set();
  const configKeys = new Set();

  for (const country of Object.keys(root)) {
    const domains = root[country];
    if (!domains) continue;

    for (const domain of Object.keys(domains)) {
      const devices = domains[domain];
      if (!devices) continue;

      for (const device of Object.keys(devices)) {
        const cohortKey = asKey(country, domain, device);

        const bidders = [];
        gatherBiddersFromNode(devices[device], bidders);

        // ---- Unique bidder sets (IDs only) ----
        const idsOnly = Array.from(new Set(bidders.map(b => String(b)))).sort();
        const setKey = hash(idsOnly);
        setKeys.add(setKey);

        // ---- Unique bidder configs (IDs + params) ----
        // Since bidders are just strings, configs are the same as IDs
        const configs = idsOnly.map(id => ({ id }));
        const configKey = hash(configs);
        configKeys.add(configKey);

        cohortResults.push({ cohortKey, idsOnly, configs });
      }
    }
  }

  const result = {
    date: new Date().toISOString().slice(0, 10),
    cohorts_total: cohortResults.length,
    unique_bidder_lists: setKeys.size,
    unique_bidder_configs: configKeys.size,
    notes: [
      'Unique bidder lists = IDs only (ignores params, RTT).',
      'Unique bidder configs = IDs + key bidder params (timeout, weight, floor, dealIds).'
    ]
  };

  console.log(JSON.stringify(result, null, 2));
}

main();