-- Create dedicated database for QA Testing application
-- Note: This must be run as a superuser or database administrator
-- Run this command from psql or pgAdmin:
-- CREATE DATABASE qa_testing;

-- Or use the following if connecting as postgres user:
-- psql -U postgres -c "CREATE DATABASE qa_testing;"

-- After creating the database, connect to it:
-- \c qa_testing

-- Then run the next migration file (001_create_tables.sql)

