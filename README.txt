FEED PLANT SUPABASE VALUE FIX

Files:
- SUPABASE_VALUE_FIX.js
- service-worker-fixed.js
- APPLY.txt

This package is intentionally a patch package.
It is based on the CURRENT GitHub app.js architecture, not the older
app(1).js file.

The main issue addressed is numeric values becoming null between Supabase
JSONB -> dashboard stock/detail rendering, plus stale service-worker caching.
