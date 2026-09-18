\restrict i2yF4Sh8C6xQJdLngyUdvNlGTGe2A5z2kzHCOlo0Of9j69jkAgazAWxBrrOgZkL
COMMENT ON SCHEMA public IS '';
CREATE TABLE public.admins (
    id integer NOT NULL,
    username character varying(64) NOT NULL,
    password_hash character varying(300) NOT NULL,
    name character varying(128) NOT NULL,
    role character varying(16) NOT NULL,
    is_active boolean NOT NULL,
    last_login_at timestamp with time zone,
    password_changed_at timestamp with time zone,
    failed_attempts integer NOT NULL,
    locked_until timestamp with time zone,
    telegram_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;
CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);
CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    admin_id integer,
    actor character varying(64) NOT NULL,
    action character varying(64) NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying(64) NOT NULL,
    ip character varying(64) NOT NULL,
    details json NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;
CREATE TABLE public.auth_throttle (
    key character varying(128) NOT NULL,
    attempts integer NOT NULL,
    window_start timestamp with time zone NOT NULL,
    locked_until timestamp with time zone
);
CREATE TABLE public.bank_links (
    id integer NOT NULL,
    key character varying(24) NOT NULL,
    name character varying(48) NOT NULL,
    prefix character varying(300) NOT NULL,
    kind character varying(12) NOT NULL,
    enabled boolean NOT NULL,
    priority integer NOT NULL,
    encode_payload boolean NOT NULL
);
CREATE SEQUENCE public.bank_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bank_links_id_seq OWNED BY public.bank_links.id;
CREATE TABLE public.bot_sessions (
    id integer NOT NULL,
    bot character varying(16) NOT NULL,
    telegram_id bigint NOT NULL,
    state character varying(48) NOT NULL,
    data json NOT NULL,
    panel_message_id bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.bot_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.bot_sessions_id_seq OWNED BY public.bot_sessions.id;
CREATE TABLE public.deposits (
    id integer NOT NULL,
    public_id character varying(32) NOT NULL,
    user_id integer NOT NULL,
    cash_id integer NOT NULL,
    requisite_id integer,
    player_id character varying(32) NOT NULL,
    player_name character varying(160) NOT NULL,
    amount numeric(14,2) NOT NULL,
    pay_amount numeric(14,2) NOT NULL,
    currency character varying(8) NOT NULL,
    status character varying(16) NOT NULL,
    qr_payload text NOT NULL,
    payment_event_id integer,
    payment_source character varying(24) NOT NULL,
    paid_at timestamp with time zone,
    credited_at timestamp with time zone,
    provider_ref character varying(128) NOT NULL,
    provider_response json NOT NULL,
    error character varying(600) NOT NULL,
    idempotency_key character varying(96) NOT NULL,
    expires_at timestamp with time zone,
    processing_started_at timestamp with time zone,
    closed_at timestamp with time zone,
    operator_id integer,
    source character varying(16) NOT NULL,
    notified_final boolean NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.deposits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.deposits_id_seq OWNED BY public.deposits.id;
CREATE TABLE public.email_verifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    email character varying(160) NOT NULL,
    code_hash character varying(64) NOT NULL,
    attempts integer NOT NULL,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp with time zone NOT NULL
);
CREATE SEQUENCE public.email_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.email_verifications_id_seq OWNED BY public.email_verifications.id;
CREATE TABLE public.jobs (
    id integer NOT NULL,
    kind character varying(48) NOT NULL,
    payload json NOT NULL,
    dedupe_key character varying(128),
    status character varying(16) NOT NULL,
    attempts integer NOT NULL,
    max_attempts integer NOT NULL,
    run_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    locked_at timestamp with time zone,
    locked_by character varying(64) NOT NULL,
    last_error character varying(600) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    finished_at timestamp with time zone
);
CREATE SEQUENCE public.jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.jobs_id_seq OWNED BY public.jobs.id;
CREATE TABLE public.notifications (
    id integer NOT NULL,
    event_key character varying(160) NOT NULL,
    channel character varying(24) NOT NULL,
    bot character varying(16) NOT NULL,
    level character varying(12) NOT NULL,
    event character varying(48) NOT NULL,
    target_telegram_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    body text NOT NULL,
    data json NOT NULL,
    status character varying(16) NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at timestamp with time zone,
    error character varying(400) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    telegram_message_id bigint NOT NULL
);
CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;
CREATE TABLE public.payment_cashes (
    id integer NOT NULL,
    key character varying(32) NOT NULL,
    name character varying(64) NOT NULL,
    provider_type character varying(24) NOT NULL,
    enabled boolean NOT NULL,
    priority integer NOT NULL,
    currency character varying(8) NOT NULL,
    accepted_currency_ids character varying(200) NOT NULL,
    ip_address character varying(64) NOT NULL,
    base_url character varying(300) NOT NULL,
    credentials_enc text NOT NULL,
    deposit_enabled boolean NOT NULL,
    withdraw_enabled boolean NOT NULL,
    deposit_min numeric(14,2) NOT NULL,
    deposit_max numeric(14,2) NOT NULL,
    withdraw_min numeric(14,2) NOT NULL,
    withdraw_max numeric(14,2) NOT NULL,
    deposit_fee_pct numeric(6,3) NOT NULL,
    withdraw_fee_pct numeric(6,3) NOT NULL,
    auto_disable_enabled boolean NOT NULL,
    low_balance_threshold numeric(14,2) NOT NULL,
    critical_balance_threshold numeric(14,2) NOT NULL,
    auto_enable_threshold numeric(14,2) NOT NULL,
    max_daily_limit numeric(14,2) NOT NULL,
    auto_disabled boolean NOT NULL,
    auto_disabled_at timestamp with time zone,
    last_balance numeric(14,2),
    last_limit numeric(14,2),
    last_check_at timestamp with time zone,
    last_check_ok boolean,
    last_check_message character varying(400) NOT NULL,
    instructions_text text NOT NULL,
    instruction_photo character varying(300) NOT NULL,
    notes text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.payment_cashes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payment_cashes_id_seq OWNED BY public.payment_cashes.id;
CREATE TABLE public.payment_events (
    id integer NOT NULL,
    source character varying(24) NOT NULL,
    event_key character varying(96) NOT NULL,
    external_id character varying(160) NOT NULL,
    amount numeric(14,2) NOT NULL,
    currency character varying(8) NOT NULL,
    raw_text text NOT NULL,
    raw_payload json NOT NULL,
    status character varying(16) NOT NULL,
    deposit_id integer,
    attempts integer NOT NULL,
    error character varying(400) NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp with time zone,
    sender_ip character varying(64) NOT NULL
);
CREATE SEQUENCE public.payment_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payment_events_id_seq OWNED BY public.payment_events.id;
CREATE TABLE public.payment_requisites (
    id integer NOT NULL,
    name character varying(64) NOT NULL,
    bank_type character varying(32) NOT NULL,
    bank_name character varying(64) NOT NULL,
    enabled boolean NOT NULL,
    priority integer NOT NULL,
    payload text NOT NULL,
    account character varying(64) NOT NULL,
    holder character varying(128) NOT NULL,
    cash_id integer,
    notes text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.payment_requisites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payment_requisites_id_seq OWNED BY public.payment_requisites.id;
CREATE TABLE public.push_deliveries (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    subscription_id integer NOT NULL,
    status character varying(16) NOT NULL,
    attempts integer NOT NULL,
    next_attempt_at timestamp with time zone,
    error character varying(300) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.push_deliveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.push_deliveries_id_seq OWNED BY public.push_deliveries.id;
CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    admin_id integer,
    endpoint text NOT NULL,
    endpoint_hash character varying(64) NOT NULL,
    p256dh character varying(200) NOT NULL,
    auth character varying(100) NOT NULL,
    user_agent character varying(300) NOT NULL,
    enabled boolean NOT NULL,
    fail_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_ok_at timestamp with time zone
);
CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;
CREATE TABLE public.qr_records (
    id integer NOT NULL,
    user_id integer NOT NULL,
    telegram_file_id character varying(256) NOT NULL,
    file_url text NOT NULL,
    local_path character varying(300) NOT NULL,
    payload text NOT NULL,
    bank_name character varying(64) NOT NULL,
    fingerprint character varying(64) NOT NULL,
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    uses integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.qr_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.qr_records_id_seq OWNED BY public.qr_records.id;
CREATE TABLE public.referral_payouts (
    id integer NOT NULL,
    public_id character varying(32) NOT NULL,
    user_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    qr_record_id integer,
    status character varying(16) NOT NULL,
    operator_id integer,
    error character varying(300) NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.referral_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.referral_payouts_id_seq OWNED BY public.referral_payouts.id;
CREATE TABLE public.referral_rewards (
    id integer NOT NULL,
    referrer_id integer NOT NULL,
    invited_id integer NOT NULL,
    deposit_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    reward numeric(14,2) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.referral_rewards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.referral_rewards_id_seq OWNED BY public.referral_rewards.id;
CREATE TABLE public.saved_player_ids (
    id integer NOT NULL,
    user_id integer NOT NULL,
    cash_id integer NOT NULL,
    player_id character varying(32) NOT NULL,
    player_name character varying(160) NOT NULL,
    currency character varying(16) NOT NULL,
    last_used_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.saved_player_ids_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.saved_player_ids_id_seq OWNED BY public.saved_player_ids.id;
CREATE TABLE public.sessions (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    previous_token_hash character varying(64) NOT NULL,
    csrf_token character varying(64) NOT NULL,
    ip character varying(64) NOT NULL,
    user_agent character varying(300) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    rotated_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    absolute_expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason character varying(64) NOT NULL
);
CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;
CREATE TABLE public.support_conversations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    status character varying(24) NOT NULL,
    category character varying(24) NOT NULL,
    subject character varying(200) NOT NULL,
    priority character varying(12) NOT NULL,
    deposit_id integer,
    withdrawal_id integer,
    context json NOT NULL,
    assigned_admin_id integer,
    unread_count integer NOT NULL,
    last_message_at timestamp with time zone,
    last_user_message_at timestamp with time zone,
    escalated_at timestamp with time zone,
    resolved_at timestamp with time zone,
    rating integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.support_conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.support_conversations_id_seq OWNED BY public.support_conversations.id;
CREATE TABLE public.support_messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    direction character varying(8) NOT NULL,
    sender character varying(16) NOT NULL,
    admin_id integer,
    telegram_message_id bigint NOT NULL,
    kind character varying(16) NOT NULL,
    text text NOT NULL,
    file_url text NOT NULL,
    intent character varying(32) NOT NULL,
    confidence numeric(4,3) NOT NULL,
    dedupe_key character varying(96),
    read_by_admin boolean NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.support_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;
CREATE TABLE public.support_rate_limits (
    telegram_id bigint NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer NOT NULL,
    last_message_at timestamp with time zone,
    last_text_hash character varying(64) NOT NULL,
    last_text_at timestamp with time zone,
    repeats integer NOT NULL,
    cooldown_until timestamp with time zone,
    last_escalation_at timestamp with time zone,
    warned_at timestamp with time zone
);
CREATE SEQUENCE public.support_rate_limits_telegram_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.support_rate_limits_telegram_id_seq OWNED BY public.support_rate_limits.telegram_id;
CREATE TABLE public.system_logs (
    id integer NOT NULL,
    level character varying(12) NOT NULL,
    category character varying(32) NOT NULL,
    title character varying(200) NOT NULL,
    detail text NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.system_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.system_logs_id_seq OWNED BY public.system_logs.id;
CREATE TABLE public.system_settings (
    key character varying(64) NOT NULL,
    value json NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by character varying(64) NOT NULL
);
CREATE TABLE public.users (
    id integer NOT NULL,
    telegram_id bigint NOT NULL,
    username character varying(64) NOT NULL,
    first_name character varying(128) NOT NULL,
    last_name character varying(128) NOT NULL,
    language character varying(8) NOT NULL,
    phone character varying(32) NOT NULL,
    phone_verified_at timestamp with time zone,
    email character varying(160) NOT NULL,
    email_verified_at timestamp with time zone,
    is_blocked boolean NOT NULL,
    block_reason character varying(300) NOT NULL,
    support_blocked boolean NOT NULL,
    support_block_reason character varying(300) NOT NULL,
    note text NOT NULL,
    referral_code character varying(24) NOT NULL,
    referred_by_id integer,
    referral_balance numeric(14,2) NOT NULL,
    referral_total numeric(14,2) NOT NULL,
    last_seen_at timestamp with time zone,
    deposits_count integer NOT NULL,
    withdrawals_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
CREATE TABLE public.withdrawals (
    id integer NOT NULL,
    public_id character varying(32) NOT NULL,
    user_id integer NOT NULL,
    cash_id integer NOT NULL,
    player_id character varying(32) NOT NULL,
    player_name character varying(160) NOT NULL,
    amount numeric(14,2) NOT NULL,
    currency character varying(8) NOT NULL,
    code character varying(64) NOT NULL,
    provider_ref character varying(128) NOT NULL,
    provider_claim_key character varying(160) NOT NULL,
    provider_response json NOT NULL,
    qr_record_id integer,
    qr_file_url text NOT NULL,
    qr_payload text NOT NULL,
    generated_qr_payload text NOT NULL,
    status character varying(16) NOT NULL,
    needs_attention boolean NOT NULL,
    deferred boolean NOT NULL,
    error character varying(600) NOT NULL,
    idempotency_key character varying(96) NOT NULL,
    operator_id integer,
    processing_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    closed_at timestamp with time zone,
    source character varying(16) NOT NULL,
    notified_final boolean NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.withdrawals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.withdrawals_id_seq OWNED BY public.withdrawals.id;
ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);
ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);
ALTER TABLE ONLY public.bank_links ALTER COLUMN id SET DEFAULT nextval('public.bank_links_id_seq'::regclass);
ALTER TABLE ONLY public.bot_sessions ALTER COLUMN id SET DEFAULT nextval('public.bot_sessions_id_seq'::regclass);
ALTER TABLE ONLY public.deposits ALTER COLUMN id SET DEFAULT nextval('public.deposits_id_seq'::regclass);
ALTER TABLE ONLY public.email_verifications ALTER COLUMN id SET DEFAULT nextval('public.email_verifications_id_seq'::regclass);
ALTER TABLE ONLY public.jobs ALTER COLUMN id SET DEFAULT nextval('public.jobs_id_seq'::regclass);
ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);
ALTER TABLE ONLY public.payment_cashes ALTER COLUMN id SET DEFAULT nextval('public.payment_cashes_id_seq'::regclass);
ALTER TABLE ONLY public.payment_events ALTER COLUMN id SET DEFAULT nextval('public.payment_events_id_seq'::regclass);
ALTER TABLE ONLY public.payment_requisites ALTER COLUMN id SET DEFAULT nextval('public.payment_requisites_id_seq'::regclass);
ALTER TABLE ONLY public.push_deliveries ALTER COLUMN id SET DEFAULT nextval('public.push_deliveries_id_seq'::regclass);
ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);
ALTER TABLE ONLY public.qr_records ALTER COLUMN id SET DEFAULT nextval('public.qr_records_id_seq'::regclass);
ALTER TABLE ONLY public.referral_payouts ALTER COLUMN id SET DEFAULT nextval('public.referral_payouts_id_seq'::regclass);
ALTER TABLE ONLY public.referral_rewards ALTER COLUMN id SET DEFAULT nextval('public.referral_rewards_id_seq'::regclass);
ALTER TABLE ONLY public.saved_player_ids ALTER COLUMN id SET DEFAULT nextval('public.saved_player_ids_id_seq'::regclass);
ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);
ALTER TABLE ONLY public.support_conversations ALTER COLUMN id SET DEFAULT nextval('public.support_conversations_id_seq'::regclass);
ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);
ALTER TABLE ONLY public.support_rate_limits ALTER COLUMN telegram_id SET DEFAULT nextval('public.support_rate_limits_telegram_id_seq'::regclass);
ALTER TABLE ONLY public.system_logs ALTER COLUMN id SET DEFAULT nextval('public.system_logs_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.withdrawals ALTER COLUMN id SET DEFAULT nextval('public.withdrawals_id_seq'::regclass);
ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);
ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auth_throttle
    ADD CONSTRAINT auth_throttle_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.bank_links
    ADD CONSTRAINT bank_links_key_key UNIQUE (key);
ALTER TABLE ONLY public.bank_links
    ADD CONSTRAINT bank_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bot_sessions
    ADD CONSTRAINT bot_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_public_id_key UNIQUE (public_id);
ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_dedupe_key_key UNIQUE (dedupe_key);
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_event_key_key UNIQUE (event_key);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_cashes
    ADD CONSTRAINT payment_cashes_key_key UNIQUE (key);
ALTER TABLE ONLY public.payment_cashes
    ADD CONSTRAINT payment_cashes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_event_key_key UNIQUE (event_key);
ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payment_requisites
    ADD CONSTRAINT payment_requisites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.push_deliveries
    ADD CONSTRAINT push_deliveries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_hash_key UNIQUE (endpoint_hash);
ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.qr_records
    ADD CONSTRAINT qr_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_public_id_key UNIQUE (public_id);
ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_deposit_id_key UNIQUE (deposit_id);
ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.saved_player_ids
    ADD CONSTRAINT saved_player_ids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_dedupe_key_key UNIQUE (dedupe_key);
ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_rate_limits
    ADD CONSTRAINT support_rate_limits_pkey PRIMARY KEY (telegram_id);
ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.bot_sessions
    ADD CONSTRAINT uq_bot_sessions_bot_chat UNIQUE (bot, telegram_id);
ALTER TABLE ONLY public.push_deliveries
    ADD CONSTRAINT uq_push_delivery UNIQUE (notification_id, subscription_id);
ALTER TABLE ONLY public.saved_player_ids
    ADD CONSTRAINT uq_saved_player UNIQUE (user_id, cash_id, player_id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_referral_code_key UNIQUE (referral_code);
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_provider_claim_key_key UNIQUE (provider_claim_key);
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_public_id_key UNIQUE (public_id);
CREATE INDEX ix_audit_logs_action ON public.audit_logs USING btree (action);
CREATE INDEX ix_audit_logs_created ON public.audit_logs USING btree (created_at);
CREATE INDEX ix_deposits_expires ON public.deposits USING btree (expires_at);
CREATE INDEX ix_deposits_pay_amount_status ON public.deposits USING btree (pay_amount, status);
CREATE INDEX ix_deposits_status ON public.deposits USING btree (status);
CREATE INDEX ix_deposits_status_created ON public.deposits USING btree (status, created_at);
CREATE INDEX ix_deposits_user_created ON public.deposits USING btree (user_id, created_at);
CREATE INDEX ix_jobs_kind ON public.jobs USING btree (kind);
CREATE INDEX ix_jobs_status ON public.jobs USING btree (status);
CREATE INDEX ix_jobs_status_run_at ON public.jobs USING btree (status, run_at);
CREATE INDEX ix_notifications_channel ON public.notifications USING btree (channel);
CREATE INDEX ix_notifications_channel_status_id ON public.notifications USING btree (channel, status, id);
CREATE INDEX ix_notifications_status ON public.notifications USING btree (status);
CREATE INDEX ix_payment_events_status ON public.payment_events USING btree (status);
CREATE INDEX ix_payment_events_status_received ON public.payment_events USING btree (status, received_at);
CREATE INDEX ix_push_deliveries_status_next ON public.push_deliveries USING btree (status, next_attempt_at);
CREATE INDEX ix_qr_records_user_last ON public.qr_records USING btree (user_id, last_used_at);
CREATE INDEX ix_saved_player_user_cash ON public.saved_player_ids USING btree (user_id, cash_id);
CREATE INDEX ix_sessions_admin_id ON public.sessions USING btree (admin_id);
CREATE INDEX ix_support_conversations_status ON public.support_conversations USING btree (status);
CREATE INDEX ix_support_conversations_user_status ON public.support_conversations USING btree (user_id, status);
CREATE INDEX ix_support_messages_conv_created ON public.support_messages USING btree (conversation_id, created_at);
CREATE INDEX ix_system_logs_category ON public.system_logs USING btree (category);
CREATE INDEX ix_system_logs_created ON public.system_logs USING btree (created_at);
CREATE INDEX ix_system_logs_level ON public.system_logs USING btree (level);
CREATE INDEX ix_users_referred_by ON public.users USING btree (referred_by_id);
CREATE UNIQUE INDEX ix_users_telegram_id ON public.users USING btree (telegram_id);
CREATE INDEX ix_withdrawals_cash_player_code ON public.withdrawals USING btree (cash_id, player_id, code);
CREATE INDEX ix_withdrawals_status ON public.withdrawals USING btree (status);
CREATE INDEX ix_withdrawals_status_created ON public.withdrawals USING btree (status, created_at);
CREATE INDEX ix_withdrawals_user_created ON public.withdrawals USING btree (user_id, created_at);
CREATE UNIQUE INDEX ux_deposits_active_pay_amount ON public.deposits USING btree (pay_amount) WHERE ((status)::text = ANY ((ARRAY['created'::character varying, 'processing'::character varying])::text[]));
CREATE UNIQUE INDEX ux_users_email_nonempty ON public.users USING btree (email) WHERE (((email)::text <> ''::text) AND (email_verified_at IS NOT NULL));
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_cash_id_fkey FOREIGN KEY (cash_id) REFERENCES public.payment_cashes(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_payment_event_id_fkey FOREIGN KEY (payment_event_id) REFERENCES public.payment_events(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_requisite_id_fkey FOREIGN KEY (requisite_id) REFERENCES public.payment_requisites(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.deposits
    ADD CONSTRAINT deposits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payment_requisites
    ADD CONSTRAINT payment_requisites_cash_id_fkey FOREIGN KEY (cash_id) REFERENCES public.payment_cashes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.push_deliveries
    ADD CONSTRAINT push_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.push_deliveries
    ADD CONSTRAINT push_deliveries_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.push_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.qr_records
    ADD CONSTRAINT qr_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_qr_record_id_fkey FOREIGN KEY (qr_record_id) REFERENCES public.qr_records(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.deposits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_invited_id_fkey FOREIGN KEY (invited_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.referral_rewards
    ADD CONSTRAINT referral_rewards_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.saved_player_ids
    ADD CONSTRAINT saved_player_ids_cash_id_fkey FOREIGN KEY (cash_id) REFERENCES public.payment_cashes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.saved_player_ids
    ADD CONSTRAINT saved_player_ids_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_assigned_admin_id_fkey FOREIGN KEY (assigned_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES public.deposits(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.support_conversations
    ADD CONSTRAINT support_conversations_withdrawal_id_fkey FOREIGN KEY (withdrawal_id) REFERENCES public.withdrawals(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.support_conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_referred_by_id_fkey FOREIGN KEY (referred_by_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_cash_id_fkey FOREIGN KEY (cash_id) REFERENCES public.payment_cashes(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.admins(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_qr_record_id_fkey FOREIGN KEY (qr_record_id) REFERENCES public.qr_records(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.withdrawals
    ADD CONSTRAINT withdrawals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
\unrestrict i2yF4Sh8C6xQJdLngyUdvNlGTGe2A5z2kzHCOlo0Of9j69jkAgazAWxBrrOgZkL
