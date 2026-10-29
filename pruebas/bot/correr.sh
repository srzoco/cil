#!/bin/sh
# Compila la función del bot con un Supabase falso (la base de datos local) y corre las pruebas simuladas.
set -e
cd "$(dirname "$0")"
sed 's#"npm:@supabase/supabase-js@2"#"./fake-supabase.mjs"#' ../../supabase/functions/bot/index.ts > bot.ts
npx --yes esbuild@0.24.0 bot.ts --format=esm --platform=node --outfile=bot.mjs --log-level=warning
node correr.mjs
rm -f bot.ts bot.mjs
