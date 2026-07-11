// Set test env vars before any module loads
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32_chars_min!!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_chars_min!';
process.env.DATABASE_URL = 'postgresql://oncallx:oncallx@localhost:5432/oncallx_test';
process.env.REDIS_URL = 'redis://localhost:6379';
