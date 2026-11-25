#!/bin/bash
# Chạy lại từ CSDL trống rồi kiểm thử nghiệp vụ
cd "$(dirname "$0")/.." && npx supabase db reset >/dev/null 2>&1 || exit 1
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
SB_ANON=$ANON_KEY SB_SERVICE=$SERVICE_ROLE_KEY node tests/business.test.mjs
