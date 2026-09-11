DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'schedules'
          AND column_name = 'last_run_at'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE schedules
            ALTER COLUMN last_run_at TYPE TIMESTAMPTZ
            USING last_run_at AT TIME ZONE 'UTC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'schedules'
          AND column_name = 'next_run_at'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE schedules
            ALTER COLUMN next_run_at TYPE TIMESTAMPTZ
            USING next_run_at AT TIME ZONE 'UTC';
    END IF;
END $$;