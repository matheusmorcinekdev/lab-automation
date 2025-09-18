const fs = require('fs');
const path = require('path');

function analyzeMetrics(filePath) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    const cohorts = new Set();
    const bidderConfigs = new Set();
    const bidderFrequency = new Map();
    const cohortConfigCounts = new Map();
    let totalBidderConfigs = 0;
    
    // Navigate through the structure: Country → Domain → Device → Placement
    const defaultConfig = data.defaultConfig;
    
    for (const [country, domains] of Object.entries(defaultConfig)) {
        for (const [domain, devices] of Object.entries(domains)) {
            for (const [device, placements] of Object.entries(devices)) {
                for (const [placement, configs] of Object.entries(placements)) {
                    // Create cohort identifier
                    const cohortId = `${country}+${domain}+${device}+${placement}`;
                    cohorts.add(cohortId);
                    
                    // Count configurations per cohort
                    const validConfigs = configs.filter(config => config.bidders && Array.isArray(config.bidders));
                    cohortConfigCounts.set(cohortId, validConfigs.length);
                    
                    // Process each configuration in this cohort
                    for (const config of configs) {
                        if (config.bidders && Array.isArray(config.bidders)) {
                            // Count total bidder configurations (every occurrence)
                            totalBidderConfigs++;
                            
                            // Create unique bidder config (sorted for consistency)
                            const sortedBidders = [...config.bidders].sort();
                            const bidderConfigId = sortedBidders.join(',');
                            bidderConfigs.add(bidderConfigId);
                            
                            // Count frequency of each bidder
                            for (const bidder of config.bidders) {
                                bidderFrequency.set(bidder, (bidderFrequency.get(bidder) || 0) + 1);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Sort bidders by frequency
    const sortedBidders = Array.from(bidderFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([bidder, frequency]) => ({ bidder, frequency }));
    
    // Calculate cohort complexity metrics
    const cohortsWithMultipleConfigs = Array.from(cohortConfigCounts.values()).filter(count => count > 1).length;
    const avgConfigsPerCohort = totalBidderConfigs / cohorts.size;
    
    return {
        totalCohorts: cohorts.size,
        uniqueBidderConfigs: bidderConfigs.size,
        bidderConfigurations: {
            count: totalBidderConfigs,
            configurations: Array.from(bidderConfigs).map(config => config.split(','))
        },
        cohortComplexity: {
            cohortsWithMultipleConfigs: cohortsWithMultipleConfigs,
            percentageWithMultipleConfigs: ((cohortsWithMultipleConfigs / cohorts.size) * 100).toFixed(1),
            averageConfigsPerCohort: avgConfigsPerCohort.toFixed(2)
        },
        bidderFrequency: {
            total: sortedBidders.length,
            topBidders: sortedBidders.slice(0, 10),
            leastUsedBidders: sortedBidders.slice(-10).reverse()
        },
        analysisDate: new Date().toISOString(),
        sourceFile: path.basename(filePath)
    };
}

function main() {
    const filePath = process.argv[2];
    
    if (!filePath) {
        console.error('Usage: node index.js <path-to-json-file>');
        process.exit(1);
    }
    
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    
    try {
        const results = analyzeMetrics(filePath);
        
        // Save results to daily-result.json
        const outputPath = path.join(__dirname, 'daily-result.json');
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        
        console.log('Analysis completed successfully!');
        console.log(`Results saved to: ${outputPath}`);
        console.log('\nSummary:');
        console.log(`- Total cohorts: ${results.totalCohorts}`);
        console.log(`- Total bidder configurations: ${results.bidderConfigurations.count}`);
        console.log(`- Unique bidder configurations: ${results.uniqueBidderConfigs}`);
        console.log(`- Cohorts with multiple configs: ${results.cohortComplexity.cohortsWithMultipleConfigs} (${results.cohortComplexity.percentageWithMultipleConfigs}%)`);
        console.log(`- Average configs per cohort: ${results.cohortComplexity.averageConfigsPerCohort}`);
        console.log(`- Total unique bidders: ${results.bidderFrequency.total}`);
        console.log(`- Top bidder: ${results.bidderFrequency.topBidders[0]?.bidder} (${results.bidderFrequency.topBidders[0]?.frequency} occurrences)`);
        
    } catch (error) {
        console.error('Error analyzing file:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { analyzeMetrics };
