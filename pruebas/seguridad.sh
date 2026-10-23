#!/bin/bash
# Corre pruebas/seguridad.sql sobre una base recién instalada y falla si algo que debía bloquearse pasó.
# Uso: pruebas/seguridad.sh "<psql y sus opciones de conexión>"   (la base ya tiene stub + cil.sql)
set -o pipefail
salida=$($1 -q -At -f pruebas/seguridad.sql 2>&1 | grep -v NOTICE) || { echo "$salida"; exit 1; }
echo "$salida"
malos=$(echo "$salida" | grep -E '^(RPC|INTERNA|TABLA|C |X ).*PERMITIDO \([1-9]|^LEER .*\(0\) +PERMITIDO \([1-9]|^LEER personas.*PERMITIDO \(([02-9]|[1-9][0-9])')
if [ -n "$malos" ]; then echo; echo "FALLA DE SEGURIDAD:"; echo "$malos"; exit 1; fi
echo "OK: $(echo "$salida" | grep -c 'BLOQUEADO\|PERMITIDO') intentos, ninguno pasó."
