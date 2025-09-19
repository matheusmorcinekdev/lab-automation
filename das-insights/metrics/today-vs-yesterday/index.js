const fs = require('fs');
const path = require('path');

function extractCohortData(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const cohortData = new Map();
    
    const defaultConfig = data.defaultConfig;
    
    for (const [country, domains] of Object.entries(defaultConfig)) {
        for (const [domain, devices] of Object.entries(domains)) {
            for (const [device, placements] of Object.entries(devices)) {
                for (const [placement, configs] of Object.entries(placements)) {
                    const cohortId = `${country}+${domain}+${device}+${placement}`;
                    
                    // Collect all bidder configurations for this cohort
                    const bidderConfigs = [];
                    for (const config of configs) {
                        if (config.bidders && Array.isArray(config.bidders)) {
                            // Sort bidders for consistent comparison
                            const sortedBidders = [...config.bidders].sort();
                            bidderConfigs.push(sortedBidders);
                        }
                    }
                    
                    cohortData.set(cohortId, bidderConfigs);
                }
            }
        }
    }
    
    return cohortData;
}

function compareBidderConfigs(todayConfigs, yesterdayConfigs) {
    // Note IMPORTANT: Currently comparing additions/removals only. 
    // consider reordering as change
    
    const todaySet = new Set(todayConfigs.map(config => config.join(',')));
    const yesterdaySet = new Set(yesterdayConfigs.map(config => config.join(',')));
    
    return !areSetsEqual(todaySet, yesterdaySet);
}

function areSetsEqual(set1, set2) {
    if (set1.size !== set2.size) return false;
    for (const item of set1) {
        if (!set2.has(item)) return false;
    }
    return true;
}

function compareConfigs(todayFilePath, yesterdayFilePath) {
    const todayCohorts = extractCohortData(todayFilePath);
    const yesterdayCohorts = extractCohortData(yesterdayFilePath);
    
    const cohortsAppeared = [];
    const cohortsDisappeared = [];
    const cohortsWithBidderChanges = [];
    
    // Find cohorts that appeared (in today but not in yesterday)
    for (const cohortId of todayCohorts.keys()) {
        if (!yesterdayCohorts.has(cohortId)) {
            cohortsAppeared.push(cohortId);
        }
    }
    
    // Find cohorts that disappeared (in yesterday but not in today)
    for (const cohortId of yesterdayCohorts.keys()) {
        if (!todayCohorts.has(cohortId)) {
            cohortsDisappeared.push(cohortId);
        }
    }
    
    // Find cohorts with bidder changes (exist in both but different configs)
    let unchangedCohortsCount = 0;
    for (const cohortId of todayCohorts.keys()) {
        if (yesterdayCohorts.has(cohortId)) {
            const todayConfigs = todayCohorts.get(cohortId);
            const yesterdayConfigs = yesterdayCohorts.get(cohortId);
            
            if (compareBidderConfigs(todayConfigs, yesterdayConfigs)) {
                cohortsWithBidderChanges.push(cohortId);
            } else {
                unchangedCohortsCount++;
            }
        }
    }
    
    return {
        cohortsAppeared: {
            count: cohortsAppeared.length,
            cohorts: cohortsAppeared
        },
        cohortsDisappeared: {
            count: cohortsDisappeared.length,
            cohorts: cohortsDisappeared
        },
        cohortsWithBidderChanges: {
            count: cohortsWithBidderChanges.length,
            cohorts: cohortsWithBidderChanges
        },
        summary: {
            totalTodayCohorts: todayCohorts.size,
            totalYesterdayCohorts: yesterdayCohorts.size,
            netCohortChange: todayCohorts.size - yesterdayCohorts.size,
            unchangedCohorts: unchangedCohortsCount
        },
        analysisDate: new Date().toISOString(),
        todayFile: path.basename(todayFilePath),
        yesterdayFile: path.basename(yesterdayFilePath)
    };
}

function main() {
    const todayFilePath = process.argv[2];
    const yesterdayFilePath = process.argv[3];
    
    if (!todayFilePath || !yesterdayFilePath) {
        console.error('Usage: node index.js <today-file> <yesterday-file>');
        process.exit(1);
    }
    
    if (!fs.existsSync(todayFilePath)) {
        console.error(`Today file not found: ${todayFilePath}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(yesterdayFilePath)) {
        console.error(`Yesterday file not found: ${yesterdayFilePath}`);
        process.exit(1);
    }
    
    try {
        const results = compareConfigs(todayFilePath, yesterdayFilePath);
        
        // Save results
        const outputPath = path.join(__dirname, 'today-vs-yesterday-result.json');
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        
        console.log('Comparison completed successfully!');
        console.log(`Results saved to: ${outputPath}`);
        console.log('\nSummary:');
        console.log(`- Today cohorts: ${results.summary.totalTodayCohorts}`);
        console.log(`- Yesterday cohorts: ${results.summary.totalYesterdayCohorts}`);
        console.log(`- Net change: ${results.summary.netCohortChange > 0 ? '+' : ''}${results.summary.netCohortChange}`);
        console.log(`- Cohorts appeared: ${results.cohortsAppeared.count}`);
        console.log(`- Cohorts disappeared: ${results.cohortsDisappeared.count}`);
        console.log(`- Cohorts with bidder changes: ${results.cohortsWithBidderChanges.count}`);
        console.log(`- Unchanged cohorts: ${results.summary.unchangedCohorts}`);
        
    } catch (error) {
        console.error('Error comparing files:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { compareConfigs, extractCohortData };
