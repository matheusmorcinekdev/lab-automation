Daily Metrics (per active file, “today”, current das-2-0-bidder-selection-optimised.json)
	•	How many cohorts are there today? - Cohorts total (Country + Domain + Device + Placement).
	•	How many unique bidder configs are there today? - Distinct arrays of unique bidder sets (IDs only). 
	•	Bidder frequency across cohorts → Which bidders are in the most / fewest configs (Top bidders).


	How many sessions were in each cohort? - todo check if we can do it in the current config - or if we should add in the month metricsdan 



	todo: 

	Looking at the JSON structure, within each cohort (Country+Domain+Device+Placement), there can be multiple bidder arrays. For example, a single cohort might have different configurations based on RTT ranges or other criteria:

	{
  "US": {
    "example.com": {
      "mobile": {
        "default": [
          {
            "bidders": ["criteo", "grid", "appnexus"],
            "rttRange": "default"
          },
          {
            "bidders": ["criteo", "grid"],
            "rttRange": [31, 50]
          },
          {
            "bidders": ["pubmatic", "ix", "rubicon"],
            "rttRange": [51, 999]
          }
        ]
      }
    }
  }
}



doing new metric: how many cohorts use sophisticated RTT-based or other conditional bidding strategies vs. simple single-configuration cohorts