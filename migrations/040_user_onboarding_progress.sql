CREATE TABLE IF NOT EXISTS user_onboarding_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tour_key VARCHAR(100) NOT NULL,
    tour_version VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'offered'
        CHECK (status IN ('offered', 'skipped', 'completed')),
    offered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    skipped_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    replay_count INTEGER NOT NULL DEFAULT 0,
    last_replayed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tour_key, tour_version)
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_progress_user_id
    ON user_onboarding_progress(user_id);