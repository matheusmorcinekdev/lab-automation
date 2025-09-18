#!/usr/bin/env node
/**
 * Change Velocity Analysis: How often do bidder lists change for each cohort?
 * 
 * Usage: node changeVelocity.js <input-folder> [output-file] [options]
 * Example: node changeVelocity.js ../2.0-bidder-selection-optmised ./change-velocity.json --ignore-reorder --placement-aware
 * 
 * Options:
 *   --ignore-reorder    Don't count bidder reordering as a change
 *   --placement-aware   Compare bidder lists per placement type (default, pushdown, etc.)
 */
const fs = require('fs');
const path = require('path');

const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const FILE_RE = /^(\d{2})-([a-z]{3})-(\d{4})-das-2-0-bidder-selection-optimi[sz]ed\.json$/i;

function parseDateFromName(name) {
  const m = name.match(FILE_RE);
  if (!m) return null;
  const [_, dd, monStr, yyyy] = m;
  const mm = MON[monStr.toLowerCase()];
  if (!mm) return null;
  return `${yyyy}-${String(mm).padStart(2,'0')}-${dd}`;
}

function gatherBiddersFromNode(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) gatherBiddersFromNode(item, out);
    return;
  }
  if (Array.isArray(node.bidders)) {
    for (const b of node.bidders) {
      if (b) out.push(String(b));
    }
  }
  for (const k of Object.keys(node)) {
    if (k === 'bidders') continue;
    gatherBiddersFromNode(node[k], out);
  }
}

function analyzeChange(prevList, currList, ignoreReorder = false) {
  const prevSet = new Set(prevList);
  const currSet = new Set(currList);
  
  const added = currList.filter(b => !prevSet.has(b));
  const removed = prevList.filter(b => !currSet.has(b));
  
  // Check if lists are identical (no change)
  if (added.length === 0 && removed.length === 0 && prevList.length === currList.length) {
    return null; // No change at all
  }
  
  // Check if it's just reordering (same bidders, different order)
  const isReorder = added.length === 0 && removed.length === 0 && 
                   prevList.length === currList.length &&
                   JSON.stringify(prevList) !== JSON.stringify(currList);
  
  if (ignoreReorder && isReorder) {
    return null; // Don't count reordering as a change
  }
  
  let changeType = 'unknown';
  let description = '';
  
  if (isReorder) {
    changeType = 'reordered';
    description = `Bidder reordered: [${prevList.join(', ')}] → [${currList.join(', ')}]`;
  } else if (added.length > 0 && removed.length > 0) {
    changeType = 'replaced';
    description = `Complete replacement: [${prevList.join(', ')}] → [${currList.join(', ')}]`;
  } else if (added.length > 0) {
    changeType = 'added';
    description = `Bidder added: [${prevList.join(', ')}] → [${currList.join(', ')}] (added: ${added.join(', ')})`;
  } else if (removed.length > 0) {
    changeType = 'removed';
    description = `Bidder removed: [${prevList.join(', ')}] → [${currList.join(', ')}] (removed: ${removed.join(', ')})`;
  } else {
    // This should not happen, but if it does, don't count it as a change
    console.warn(`Unexpected change case: prev=${JSON.stringify(prevList)}, curr=${JSON.stringify(currList)}`);
    return null;
  }
  
  return {
    changeType,
    description,
    added,
    removed,
    prevList: [...prevList],
    currList: [...currList]
  };
}

function extractCohortBidders(cfg, placementAware = false) {
  const root = cfg?.defaultConfig;
  if (!root || typeof root !== 'object') {
    throw new Error('Missing defaultConfig');
  }

  const cohortBidders = new Map();
  
  for (const country of Object.keys(root)) {
    const domains = root[country];
    if (!domains) continue;
    
    for (const domain of Object.keys(domains)) {
      const devices = domains[domain];
      if (!devices) continue;
      
      for (const device of Object.keys(devices)) {
        if (placementAware) {
          // Extract bidders per placement type
          for (const placement of Object.keys(devices[device])) {
            const placementData = devices[device][placement];
            if (!Array.isArray(placementData)) continue;
            
            const bidders = [];
            gatherBiddersFromNode(placementData, bidders);
            
            if (bidders.length > 0) {
              const cohortKey = `${country}|${domain}|${device}|${placement}`;
              const bidderList = [...new Set(bidders)].sort();
              cohortBidders.set(cohortKey, bidderList);
            }
          }
        } else {
          // Original approach: aggregate all bidders for the cohort
          const cohortKey = `${country}|${domain}|${device}`;
          const bidders = [];
          gatherBiddersFromNode(devices[device], bidders);
          
          // Create normalized bidder list (sorted, unique)
          const bidderList = [...new Set(bidders)].sort();
          cohortBidders.set(cohortKey, bidderList);
        }
      }
    }
  }
  
  return cohortBidders;
}

function calculateChangeVelocity(files, inputDir, ignoreReorder = false, placementAware = false) {
  const cohortChanges = new Map(); // cohort -> { totalChanges, changeDates, lastSeen }
  let prevBidders = null;
  let prevDate = null;
  
  for (const { f, date } of files) {
    const fullPath = path.join(inputDir, f);
    console.log(`Processing ${f} → ${date}`);
    
    const cfg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const currentBidders = extractCohortBidders(cfg, placementAware);
    
    if (prevBidders && prevDate) {
      // Compare with previous day
      const allCohorts = new Set([...currentBidders.keys(), ...prevBidders.keys()]);
      
      for (const cohort of allCohorts) {
        const prevList = prevBidders.get(cohort) || [];
        const currList = currentBidders.get(cohort) || [];
        
        // Analyze the change
        const changeAnalysis = analyzeChange(prevList, currList, ignoreReorder);
        
        if (changeAnalysis) {
          if (!cohortChanges.has(cohort)) {
            cohortChanges.set(cohort, { totalChanges: 0, changeDates: [], lastSeen: null });
          }
          
          const changeData = cohortChanges.get(cohort);
          changeData.totalChanges++;
          changeData.changeDates.push({ 
            from: prevDate, 
            to: date,
            changeType: changeAnalysis.changeType,
            description: changeAnalysis.description,
            added: changeAnalysis.added,
            removed: changeAnalysis.removed
          });
          changeData.lastSeen = date;
        }
      }
    }
    
    prevBidders = currentBidders;
    prevDate = date;
  }
  
  return cohortChanges;
}

function main() {
  const args = process.argv.slice(2);
  const inputDir = args[0];
  const outputFile = args[1] || './change-velocity.json';
  
  // Parse options
  const ignoreReorder = args.includes('--ignore-reorder');
  const placementAware = args.includes('--placement-aware');
  
  if (!inputDir) {
    console.error('Usage: node changeVelocity.js <input-folder> [output-file] [options]');
    console.error('Options: --ignore-reorder, --placement-aware');
    process.exit(1);
  }
  
  // Find and sort files by date
  const files = fs.readdirSync(inputDir)
    .filter(f => FILE_RE.test(f))
    .map(f => ({ f, date: parseDateFromName(f) }))
    .filter(x => !!x.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  
  if (files.length < 2) {
    console.error('Need at least 2 files to calculate change velocity');
    process.exit(1);
  }
  
  console.log(`Found ${files.length} files. Analyzing change velocity...`);
  console.log(`Options: ignore-reorder=${ignoreReorder}, placement-aware=${placementAware}`);
  
  const cohortChanges = calculateChangeVelocity(files, inputDir, ignoreReorder, placementAware);
  
  // Convert to array and sort by change frequency
  const changeStats = Array.from(cohortChanges.entries())
    .map(([cohort, data]) => ({
      cohort,
      total_changes: data.totalChanges,
      change_frequency: (data.totalChanges / (files.length - 1)) * 100, // percentage
      last_changed: data.lastSeen,
      change_dates: data.changeDates.slice(-5) // last 5 changes
    }))
    .sort((a, b) => b.total_changes - a.total_changes);
  
  const cohortsWithChanges = changeStats.filter(c => c.total_changes > 0).length;
  const cohortsUnchanged = cohortChanges.size - cohortsWithChanges;
  
  const result = {
    analysis_period: {
      start_date: files[0].date,
      end_date: files[files.length - 1].date,
      total_days: files.length,
      comparison_days: files.length - 1
    },
    options: {
      ignore_reorder: ignoreReorder,
      placement_aware: placementAware
    },
    summary: {
      total_cohorts: cohortChanges.size,
      cohorts_with_changes: cohortsWithChanges,
      cohorts_unchanged: cohortsUnchanged,
      most_changed_cohort: changeStats[0]?.cohort || null,
      highest_change_count: changeStats[0]?.total_changes || 0
    },
    cohort_change_velocity: changeStats.slice(0, 50), // top 50 most changed
    notes: [
      'Change velocity = how often bidder lists change for each cohort',
      'change_frequency = percentage of days the cohort changed',
      'Only shows cohorts that changed at least once',
      'changeType: added, removed, reordered, replaced',
      placementAware ? 'Placement-aware: compares bidders per placement type' : 'Aggregated: compares all bidders for cohort'
    ]
  };
  
  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  
  console.log(`✅ Analysis complete! Results written to ${outputFile}`);
  console.log(`📊 Found ${result.summary.cohorts_with_changes} cohorts with changes out of ${result.summary.total_cohorts} total`);
  console.log(`🔥 Most changed cohort: ${result.summary.most_changed_cohort} (${result.summary.highest_change_count} changes)`);
}

main();
