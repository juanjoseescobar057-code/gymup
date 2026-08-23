# Desplegar el presupuesto de IA y el periodo de prueba

Dos piezas y **un orden que no se puede invertir**.

## El orden importa

`ai-proxy` llama a `ai_budget_restante` y falla CERRADO: si la función no
responde, no gasta IA y devuelve 503. Es lo correcto —mejor sin IA que sin
control de gasto— pero significa que **desplegar la función antes que el SQL
corta toda la IA en producción** hasta que llegue el SQL.

    1. SQL      (supabase/setup.sql)
    2. Funciones (ai-proxy y rc-webhook)

---

## 1. El SQL

En el panel de Supabase → **SQL Editor** → **New query**.

### 1.1 Validar sin aplicar

Pega el contenido de **`supabase/setup.sql`** envuelto así:

```sql
BEGIN;
-- ...todo el archivo...
ROLLBACK;
```

Con `ROLLBACK` al final, Postgres ejecuta todo y lo deshace. Si algo estaba
mal, sale el error y la base queda intacta. Si dice **Success**, el SQL es
válido contra el esquema real.

> **Por qué el archivo entero y no un trozo.** `setup.sql` es idempotente: se
> puede correr las veces que haga falta, y es el **único** SQL que se ejecuta en
> este proyecto. Este paso apuntó un tiempo a
> supabase/migraciones/2026-08-17-presupuesto-ia.sql (sin comillas a propósito: es historia, no un paso que seguir). Esa carpeta no la leía
> nadie —la CLI de Supabase solo mira `migrations`— así que ese archivo nunca
> fue un paso de despliegue de verdad. Ahora vive en `supabase/historico/` como
> registro de qué cambió ese día. **No lo pegues.**

### 1.2 Aplicar

Lo mismo cambiando `ROLLBACK` por `COMMIT`.

### 1.3 Comprobar

```sql
select
  (select count(*) from information_schema.columns
    where table_name = 'user_profiles' and column_name = 'is_trial')            as col_is_trial,
  (select count(*) from information_schema.tables
    where table_name = 'ai_cost_usage')                                          as tabla_costos,
  (select count(*) from pg_proc where proname = 'ai_budget_restante')            as fn_presupuesto,
  (select count(*) from pg_proc where proname = 'record_ai_cost')                as fn_registrar,
  (select count(*) from pg_proc where proname = 'apply_rc_event')                as fn_rc_event;
```

Los cinco tienen que dar **1**. Si `fn_rc_event` da **2**, quedó viva la firma
vieja y hay que volver a correr el `drop function` del final del archivo: con
las dos firmas, Postgres elige una u otra por resolución de sobrecarga y el
webhook podría escribir `is_premium` sin tocar `is_trial`.

### 1.4 Comprobar los permisos

El punto donde ya se ha fallado antes: `revoke ... from anon, authenticated`
**no** quita el permiso que Postgres concede a `PUBLIC` por defecto. Por eso el
SQL revoca también `from public`. Verificarlo:

```sql
select
  has_function_privilege('authenticated', 'public.record_ai_cost(uuid, numeric)', 'execute') as authenticated_puede,
  has_function_privilege('anon',          'public.record_ai_cost(uuid, numeric)', 'execute') as anon_puede;
```

Los dos tienen que dar **false**. Si `record_ai_cost` fuera ejecutable por un
usuario, un cliente modificado podría inflarle el gasto a otra persona hasta
dejarla sin IA el resto del mes.

---

## 2. Las funciones

```bash
npx supabase functions deploy ai-proxy rc-webhook
```

---

## 3. Comprobar que quedó vivo

Usa la app con una cuenta de prueba y mira los logs de `ai-proxy` en el panel
de Supabase. Tras cada llamada con IA:

```sql
select user_id, month, cost_usd, calls
from public.ai_cost_usage
order by month desc;
```

Si `cost_usd` sube con cada llamada, el techo está funcionando. Si la tabla
queda vacía después de usar la IA, `record_ai_cost` no se está llamando:
revisa los logs de la función buscando `record_ai_cost:`.

---

## Qué cambia para quien ya usa la app

- **Nadie pierde el premium.** `is_trial` entra en `false` para todos, que es
  el valor correcto para quien ya paga.
- **Los topes diarios bajan** (de 60 mensajes de chat a 10, de 30 escaneos de
  comida a 4). Quien estuviera usando más de eso lo va a notar.
- **El plan gratis pierde los escaneos y el chat.** A cambio le aparece el
  coach de reglas, que no gastaba nada y no existía.
- **El presupuesto empieza en cero** para todo el mundo: el mes en curso no
  arrastra el gasto anterior, que no se estaba midiendo.
