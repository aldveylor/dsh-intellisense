# IntelliSense history settings

`history_settings.tsx` edits global namespace and command history quotas independently of Profile drafts. Defaults are 3 namespace discoveries and 1 callable/argument query. Saving applies to subsequent queries in active requests and future requests, with no conversation-history rewriting. Counts are non-negative safe integers; zero disables retention for that category.
