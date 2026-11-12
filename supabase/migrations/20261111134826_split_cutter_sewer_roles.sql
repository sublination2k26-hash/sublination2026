-- Commit enum changes before using the new cutter value in the next migration.
-- Renaming preserves existing enum references in payroll snapshots and RLS policies.
alter type public.app_role rename value 'cutting_sewing' to 'sewer';
alter type public.app_role add value 'cutter';
