#!/usr/bin/env node
/**
 * Cohort count for DAS 2.0 bidder selection config.
 * Cohort identity = Country + Domain + Device Type (ordered).
 *
 * Usage: node metrics.cohorts.js path/to/config.json
 */
const fs = require('fs');
const path = require('path');

function loadJson(filePath) {
  const p = path.resolve(filePath);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function getCohortKeys(cfg) {
  // File shape: { defaultConfig: { <COUNTRY>: { <DOMAIN>: { <DEVICE>: {...placements} } } } }
  const root = cfg?.defaultConfig;
  if (!root || typeof root !== 'object') {
    throw new Error('Unexpected JSON shape: missing "defaultConfig" object.');
  }

  const cohortKeys = new Set();

  for (const country of Object.keys(root)) {
    const domains = root[country];
    if (!domains || typeof domains !== 'object') continue;

    for (const domain of Object.keys(domains)) {
      const devices = domains[domain];
      if (!devices || typeof devices !== 'object') continue;

      for (const device of Object.keys(devices)) {
        // We only care about the presence of this node; placements/RTT live below and are not part of the cohort identity.
        const key = `${country}|${domain}|${device}`;
        cohortKeys.add(key);
      }
    }
  }

  return cohortKeys;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node metrics.cohorts.js <config.json>');
    process.exit(1);
  }

  const cfg = loadJson(filePath);
  const cohorts = getCohortKeys(cfg);

  // Basic breakdown to help spot anomalies
  const breakdown = {};
  for (const key of cohorts) {
    const [country, domain, device] = key.split('|');
    breakdown[country] ??= { total: 0, domains: {} };
    breakdown[country].total++;
    breakdown[country].domains[domain] ??= new Set();
    breakdown[country].domains[domain].add(device);
  }

  // Flatten domain device counts for printing (optional)
  const countrySummaries = Object.entries(breakdown).map(([country, info]) => {
    const domainCount = Object.keys(info.domains).length;
    const devicePairs = Object.entries(info.domains).map(([d, devices]) => `${d}(${devices.size})`);
    return { country, cohortCount: info.total, domainCount, devicesPerDomain: devicePairs.slice(0, 10) };
  });

  const result = {
    date: new Date().toISOString().slice(0, 10),
    cohort_count: cohorts.size,
    notes: 'Cohort identity = Country|Domain|DeviceType',
    sample_cohorts_first_10: Array.from(cohorts).slice(0, 10), // just to help sanity-check
    by_country: countrySummaries
  };

  console.log(JSON.stringify(result, null, 2));
}

main();