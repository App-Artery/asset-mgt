-- Runs once on first container init: a separate database for real-DB
-- integration tests (TEST_DATABASE_URL) so tests never touch dev data.
CREATE DATABASE asset_mgt_test;
