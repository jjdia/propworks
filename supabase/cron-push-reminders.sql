-- PropertyWorks — cron job for the push-reminders Edge Function (V 34).
-- NOT a migration and NOT applied. Release step only, run in the SQL editor
-- AFTER schema-v10 is applied and the function is deployed.
-- Same pattern as v7's rent-reminder-check-daily job (x-cron-secret).
-- Replace <CRON_SECRET> in the editor with the value already stored in
-- Supabase → Edge Functions → Secrets. NEVER commit the real value.
select cron.schedule(
  'push-reminders-daily',
  '5 13 * * *', -- 13:05 UTC daily = 9:05am EDT / 8:05am EST (5 min after rent-reminder-check)
  $$
  select net.http_post(
    url := 'https://crdrwtxeogkloxuathzh.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>')
  );
  $$
);
