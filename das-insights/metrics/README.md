# Bidder Change Analysis

This script analyzes bidder configuration changes across multiple days to answer the question: **"How often do bidder lists change for a given cohort?"**

## What it does

The script processes JSON configuration files from the `2.0-bidder-selection-optmised` folder and calculates:

- **Total unique cohorts**: Count of unique combinations of Country + Domain + Device Type + Placement Type
- **Cohorts with bidder changes**: Number of cohorts that had their bidder lists modified during the analysis period
- **Change frequency**: Percentage of cohorts that experienced changes
- **Average changes per cohort**: Mean number of changes per cohort
- **Top changing cohorts**: Cohorts with the most frequent changes
- **Top unchanged cohorts**: Most stable cohorts (sorted by days active)

## Usage

### Option 1: Run the main script
```bash
node bidder-change-analysis.js
```

### Option 2: Use the runner script
```bash
node run-analysis.js
```

### Option 3: Use npm script
```bash
npm run analyze
```

## Output

The script generates a JSON file `bidder-change-analysis-results.json` with detailed metrics including:

- Analysis period (start/end dates, total days)
- Summary statistics
- Change distribution
- Top changing cohorts
- Top unchanged cohorts (most stable)
- Detailed metrics answering the main question

## Data Structure Expected

The script expects JSON files with the following structure:
```json
{
  "defaultConfig": {
    "COUNTRY_CODE": {
      "domain.com": {
        "device_type": {
          "placement_type": [
            {
              "bidders": ["bidder1", "bidder2", ...],
              "rttRange": "default"
            }
          ]
        }
      }
    }
  }
}
```

## Cohort Definition

A cohort is defined as: **Country + Domain + Device Type + Placement Type**

The script handles 'default' values as regular values and compares them normally.

## Requirements

- Node.js 14.0.0 or higher
- JSON files in the `../2.0-bidder-selection-optmised/` folder
- File naming format: `DD-mmm-YYYY-das-2-0-bidder-selection-optimised.json`
