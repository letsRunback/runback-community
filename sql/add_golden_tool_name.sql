-- The tool that threw, for error-reason golden entries — lets the app draft a
-- candidate policy rule from an uncovered incident (suggestRule() in
-- lib/goldenCore.ts) without re-parsing the free-text `detail` string.
ALTER TABLE ad_golden ADD COLUMN IF NOT EXISTS tool_name text;
