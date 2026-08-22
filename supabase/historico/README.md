# Histórico — NO EJECUTAR NADA DE ESTA CARPETA

Todo lo que hay aquí ya está **dentro de `supabase/setup.sql`**, que es el
único archivo que se corre. Se conservan porque cuentan cómo llegó el esquema
a ser lo que es, no porque haya que aplicarlos.

## Por qué se movieron aquí

Estos archivos estaban repartidos en tres sitios (`supabase/*.sql`,
`supabase/migrations/`, `supabase/migraciones/`) y ninguno era ejecutable de
verdad:

- **`migraciones/` (en español) nunca la leyó nadie.** La CLI de Supabase solo
  mira `supabase/migrations`. Ese archivo se creó para desplegar el presupuesto
  de IA a mano y quedó ahí, con pinta de migración y sin serlo.
- **`migrations/` tampoco se aplicaba**: el despliegue real de este proyecto es
  pegar `setup.sql` en el editor SQL. Nadie corre `supabase db push`.
- Los `schema-*.sql` son los pedazos de los que nació `setup.sql`.

## El peligro concreto que había

`0006_ai_usage_per_feature.sql` instala esta función:

```sql
create or replace function public.increment_ai_usage(
  p_user_id uuid, p_feature text, p_limit integer
) ...
grant execute on function public.increment_ai_usage(uuid, text, integer) to authenticated;
```

**El usuario y el tope los pone quien llama, y puede llamar cualquier cliente
autenticado.** O sea: pedir `p_limit => 999999` y tener IA sin tope, o inflarle
el contador a otra persona hasta dejarla sin cupo.

`setup.sql` la sustituye por `increment_ai_usage(p_feature, p_limit)`, que
deriva el dueño de `auth.uid()` y solo la puede invocar el proxy. Pero mientras
`0006` siguiera pareciendo un paso del despliegue, bastaba con que alguien lo
pegara "por si acaso" para reabrir el agujero. Por eso está aquí y no allí.

`__tests__/esquemaUnicaFuente.test.ts` falla si alguien vuelve a dejar SQL
ejecutable fuera de `setup.sql`.
