# CIL — herramientas del equipo

Una sola app con menú: cada persona entra con su correo y clave y ve solo los módulos a los que tiene acceso.
Gerencia ve todo y administra quién entra a qué.

| Carpeta | Qué es |
|---|---|
| `index.html`, `comun/` | Menú, inicio de sesión único, colores de marca y botón claro/oscuro |
| `tareas/` | Tareas del equipo (antes «tareasCIL») |
| `supabase/cil.sql` | Base de datos: se instala en el **mismo proyecto de Contenido** |
| `supabase/functions/avisos/` | Avisos al teléfono de Tareas (opcional) |
| `config.js` | Conexión a Supabase (ya trae la de Contenido) |

**Fases**
1. ✅ Menú, usuarios y accesos por módulo, Tareas en la base de Contenido, tema claro/oscuro con colores de marca.
2. Contenido se muda adentro (hoy el menú abre la app de Contenido de siempre).
3. Armador de mensajes se muda adentro (hoy el menú abre la app de siempre).

**Instalación:** sigue la guía «Instalar CIL — paso a paso». Lo importante:
- La base de datos es la de Contenido: ejecuta `supabase/cil.sql` ahí. No toca los datos de Contenido.
- **Nunca vuelvas a ejecutar el `supabase.sql` viejo de Contenido**: dejaría Contenido abierto a cualquier usuario.
- Gerencia = `rol = 'admin'` en la tabla `personas`. Los accesos de los demás se marcan en el menú → Personas y accesos.

**Actualizar:** reemplaza en GitHub todos los archivos menos `config.js`. Si cambia `cil.sql`, vuelve a ejecutarlo completo (no borra datos).
Si alguien cambia el código: sube los `?v=` de los `index.html` y `VERSION` en `sw.js`.

Detalles de las reglas de Tareas: `tareas/LEEME-tareas.md`.
