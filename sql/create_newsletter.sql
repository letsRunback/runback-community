create table if not exists newsletter_subscribers (
  email          text primary key,
  subscribed_at  timestamptz not null default now(),
  unsubscribed   boolean not null default false
);
