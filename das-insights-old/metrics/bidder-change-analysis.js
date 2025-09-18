const fs = require('fs');
const path = require('path');

/**
 * Analyzes bidder configuration changes across multiple days
 * Calculates metrics for how often bidder lists change for given cohorts
 * 
 * CHANGE DEFINITION: A cohort is considered "changed" if the bidder list composition changes:
 * - Adding a bidder: ["a", "b"] → ["a", "b", "c"]
 * - Removing a bidder: ["a", "b", "c"] → ["a", "b"] 
 * - Replacing a bidder: ["a", "b"] → ["a", "c"]
 * 
 * Reordering the same bidders does NOT count as a change: ["a", "b"] → ["b", "a"]
 */

class BidderChangeAnalyzer {
  constructor() {
    this.dataFolder = path.join(__dirname, '../2.0-bidder-selection-optmised');
    this.cohorts = new Map(); // cohort -> { bidders: Set, changes: number, days: Set }
    this.dates = [];
  }

  /**
   * Extract date from filename (e.g., "12-sep-2025-das-2-0-bidder-selection-optimised.json" -> "12-sep-2025")
   */
  extractDateFromFilename(filename) {
    const match = filename.match(/^(\d{1,2}-[a-z]{3}-\d{4})-/);
    return match ? match[1] : null;
  }

  /**
   * Create cohort key from Country + Domain + Device Type + Placement Type
   */
  createCohortKey(country, domain, deviceType, placementType) {
    return `${country}|${domain}|${deviceType}|${placementType}`;
  }

  /**
   * Parse bidders array and return sorted array for comparison
   */
  normalizeBidders(bidders) {
    return [...bidders].sort();
  }

  /**
   * Process a single configuration file
   */
  processConfigFile(filePath, date) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const defaultConfig = data.defaultConfig;

      if (!defaultConfig) {
        console.warn(`No defaultConfig found in ${filePath}`);
        return;
      }

      // Iterate through countries
      for (const [country, countryData] of Object.entries(defaultConfig)) {
        if (typeof countryData !== 'object' || countryData === null) continue;

        // Iterate through domains
        for (const [domain, domainData] of Object.entries(countryData)) {
          if (typeof domainData !== 'object' || domainData === null) continue;

          // Iterate through device types
          for (const [deviceType, deviceData] of Object.entries(domainData)) {
            if (typeof deviceData !== 'object' || deviceData === null) continue;

            // Iterate through placement types
            for (const [placementType, placementData] of Object.entries(deviceData)) {
              if (!Array.isArray(placementData) || placementData.length === 0) continue;

              // Get bidders from the first configuration (assuming single config per placement)
              const config = placementData[0];
              if (!config || !Array.isArray(config.bidders)) continue;

              const cohortKey = this.createCohortKey(country, domain, deviceType, placementType);
              const normalizedBidders = this.normalizeBidders(config.bidders);

              if (!this.cohorts.has(cohortKey)) {
                this.cohorts.set(cohortKey, {
                  bidders: normalizedBidders,
                  changes: 0,
                  days: new Set(),
                  country,
                  domain,
                  deviceType,
                  placementType,
                  bidderHistory: []
                });
              }

              const cohort = this.cohorts.get(cohortKey);
              cohort.days.add(date);

              // Check if bidders changed
              // CHANGE DEFINITION: A cohort is considered "changed" if:
              // - A bidder was added to the list
              // - A bidder was removed from the list  
              // - A bidder was replaced (which is the same as add + remove)
              // Note: Reordering the same bidders does NOT count as a change
              const currentBiddersSet = new Set(normalizedBidders);
              const previousBiddersSet = new Set(cohort.bidders);

              // Check if the sets are different (ignoring order)
              const setsAreEqual = currentBiddersSet.size === previousBiddersSet.size && 
                                 [...currentBiddersSet].every(bidder => previousBiddersSet.has(bidder));

              if (!setsAreEqual) {
                cohort.changes++;
                cohort.bidderHistory.push({
                  date,
                  bidders: normalizedBidders,
                  changeType: cohort.bidders.length > 0 ? 'modified' : 'initial'
                });
                cohort.bidders = normalizedBidders;
              } else {
                cohort.bidderHistory.push({
                  date,
                  bidders: normalizedBidders,
                  changeType: 'unchanged'
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error.message);
    }
  }

  /**
   * Load and process all configuration files
   */
  loadData() {
    try {
      const files = fs.readdirSync(this.dataFolder)
        .filter(file => file.endsWith('.json'))
        .sort(); // Sort to ensure chronological order

      console.log(`Found ${files.length} configuration files`);

      for (const file of files) {
        const date = this.extractDateFromFilename(file);
        if (!date) {
          console.warn(`Could not extract date from filename: ${file}`);
          continue;
        }

        this.dates.push(date);
        const filePath = path.join(this.dataFolder, file);
        console.log(`Processing ${date}...`);
        this.processConfigFile(filePath, date);
      }

      console.log(`Processed ${this.dates.length} days of data`);
      console.log(`Found ${this.cohorts.size} unique cohorts`);
    } catch (error) {
      console.error('Error loading data:', error.message);
      throw error;
    }
  }

  /**
   * Calculate analysis metrics
   */
  calculateMetrics() {
    const totalCohorts = this.cohorts.size;
    const cohortsWithChanges = Array.from(this.cohorts.values())
      .filter(cohort => cohort.changes > 0).length;

    const changeFrequency = cohortsWithChanges / totalCohorts;
    const avgChangesPerCohort = Array.from(this.cohorts.values())
      .reduce((sum, cohort) => sum + cohort.changes, 0) / totalCohorts;

    // File-level metrics
    const cohortsPerFile = this.dates.map(date => {
      return Array.from(this.cohorts.values())
        .filter(cohort => cohort.days.has(date)).length;
    });
    const avgCohortsPerFile = cohortsPerFile.reduce((sum, count) => sum + count, 0) / cohortsPerFile.length;
    const minCohortsPerFile = Math.min(...cohortsPerFile);
    const maxCohortsPerFile = Math.max(...cohortsPerFile);

    // Detailed change analysis
    const changeDistribution = {};
    Array.from(this.cohorts.values()).forEach(cohort => {
      const changeCount = cohort.changes;
      changeDistribution[changeCount] = (changeDistribution[changeCount] || 0) + 1;
    });

    // Top changing cohorts
    const topChangingCohorts = Array.from(this.cohorts.values())
      .filter(cohort => cohort.changes > 0)
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 10)
      .map(cohort => ({
        cohort: `${cohort.country}|${cohort.domain}|${cohort.deviceType}|${cohort.placementType}`,
        changes: cohort.changes,
        daysActive: cohort.days.size,
        changeRate: cohort.changes / cohort.days.size
      }));

    // Top unchanged cohorts (most stable)
    const topUnchangedCohorts = Array.from(this.cohorts.values())
      .filter(cohort => cohort.changes === 0)
      .sort((a, b) => b.days.size - a.days.size) // Sort by days active (most stable)
      .slice(0, 10)
      .map(cohort => ({
        cohort: `${cohort.country}|${cohort.domain}|${cohort.deviceType}|${cohort.placementType}`,
        changes: cohort.changes,
        daysActive: cohort.days.size,
        stability: '100%' // Always 100% for unchanged cohorts
      }));

    return {
      analysisPeriod: {
        startDate: this.dates[0],
        endDate: this.dates[this.dates.length - 1],
        totalDays: this.dates.length
      },
      summary: {
        totalUniqueCohorts: totalCohorts,
        cohortsWithBidderChanges: cohortsWithChanges,
        cohortsWithoutChanges: totalCohorts - cohortsWithChanges,
        changeFrequency: Math.round(changeFrequency * 10000) / 100, // percentage
        averageChangesPerCohort: Math.round(avgChangesPerCohort * 100) / 100
      },
      fileLevelMetrics: {
        averageCohortsPerFile: Math.round(avgCohortsPerFile * 100) / 100,
        minCohortsPerFile: minCohortsPerFile,
        maxCohortsPerFile: maxCohortsPerFile,
        cohortsPerFileByDate: this.dates.map((date, index) => ({
          date,
          cohortCount: cohortsPerFile[index]
        }))
      },
      changeDistribution,
      topChangingCohorts,
      topUnchangedCohorts,
      detailedMetrics: {
        question: "How often do bidder lists change for a given cohort?",
        answer: `${cohortsWithChanges} out of ${totalCohorts} cohorts (${Math.round(changeFrequency * 100)}%) experienced bidder list changes during the ${this.dates.length}-day period.`,
        averageChangeRate: `${Math.round(avgChangesPerCohort * 100) / 100} changes per cohort on average`
      }
    };
  }

  /**
   * Run the complete analysis
   */
  analyze() {
    console.log('Starting bidder change analysis...');
    this.loadData();
    const metrics = this.calculateMetrics();
    
    console.log('\n=== ANALYSIS RESULTS ===');
    console.log(`Period: ${metrics.analysisPeriod.startDate} to ${metrics.analysisPeriod.endDate} (${metrics.analysisPeriod.totalDays} days)`);
    console.log(`Total unique cohorts: ${metrics.summary.totalUniqueCohorts}`);
    console.log(`Cohorts with bidder changes: ${metrics.summary.cohortsWithBidderChanges}`);
    console.log(`Cohorts without changes: ${metrics.summary.cohortsWithoutChanges}`);
    console.log(`Change frequency: ${metrics.summary.changeFrequency}%`);
    console.log(`Average changes per cohort: ${metrics.summary.averageChangesPerCohort}`);
    
    console.log('\n📁 File-Level Metrics:');
    console.log(`Average cohorts per file: ${metrics.fileLevelMetrics.averageCohortsPerFile}`);
    console.log(`Min cohorts per file: ${metrics.fileLevelMetrics.minCohortsPerFile}`);
    console.log(`Max cohorts per file: ${metrics.fileLevelMetrics.maxCohortsPerFile}`);
    
    console.log('\n📈 Top 5 Most Changing Cohorts:');
    metrics.topChangingCohorts.slice(0, 5).forEach((cohort, index) => {
      console.log(`  ${index + 1}. ${cohort.cohort} - ${cohort.changes} changes (${cohort.daysActive} days active)`);
    });
    
    console.log('\n📊 Top 5 Most Stable Cohorts:');
    metrics.topUnchangedCohorts.slice(0, 5).forEach((cohort, index) => {
      console.log(`  ${index + 1}. ${cohort.cohort} - ${cohort.daysActive} days active (100% stable)`);
    });
    
    return metrics;
  }

  /**
   * Save results to JSON file
   */
  saveResults(metrics, outputPath = null) {
    const defaultPath = path.join(__dirname, 'bidder-change-analysis-results.json');
    const finalPath = outputPath || defaultPath;
    
    fs.writeFileSync(finalPath, JSON.stringify(metrics, null, 2));
    console.log(`\nResults saved to: ${finalPath}`);
    return finalPath;
  }
}

// Main execution
if (require.main === module) {
  console.log('Starting Bidder Change Analysis...');
  
  const analyzer = new BidderChangeAnalyzer();
  
  try {
    const results = analyzer.analyze();
    const outputPath = analyzer.saveResults(results);
    console.log(`\n✅ Analysis completed successfully!`);
    console.log(`📊 Results saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

module.exports = BidderChangeAnalyzer;
