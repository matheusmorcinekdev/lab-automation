#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Bidder Change Analysis...');
console.log('Current directory:', process.cwd());

// Check if data folder exists
const dataFolder = path.join(__dirname, '../2.0-bidder-selection-optmised');
console.log('Looking for data in:', dataFolder);

if (!fs.existsSync(dataFolder)) {
  console.error('❌ Data folder not found:', dataFolder);
  process.exit(1);
}

const files = fs.readdirSync(dataFolder).filter(f => f.endsWith('.json'));
console.log(`📁 Found ${files.length} JSON files`);

if (files.length === 0) {
  console.error('❌ No JSON files found in data folder');
  process.exit(1);
}

// Import and run the analyzer
try {
  const BidderChangeAnalyzer = require('./bidder-change-analysis');
  const analyzer = new BidderChangeAnalyzer();
  
  console.log('📊 Running analysis...');
  const results = analyzer.analyze();
  
  console.log('💾 Saving results...');
  const outputPath = analyzer.saveResults(results);
  
  console.log('✅ Analysis completed successfully!');
  console.log(`📄 Results saved to: ${outputPath}`);
  
} catch (error) {
  console.error('❌ Error during analysis:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
