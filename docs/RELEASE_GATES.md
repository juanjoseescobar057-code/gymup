# Compuertas obligatorias antes de producción abierta

GymUp maneja datos sensibles y genera recomendaciones de entrenamiento y nutrición. Por
eso un resultado verde de TypeScript o tests no equivale a autorización clínica o legal.

## Cómo liberar una versión

1. Un profesional de medicina del deporte o fisioterapia revisa el tamizaje, bloqueos,
   progresiones, mesetas, calentamientos, vuelta a la calma y mensajes de seguridad.
2. Un profesional de nutrición revisa macros, recomendaciones alimentarias y límites del
   coach. Las estimaciones fotográficas nunca deben presentarse como mediciones clínicas.
3. Un abogado revisa privacidad, tratamiento de datos sensibles, transferencias
   internacionales, términos, suscripciones y formularios de las tiendas para cada país.
4. Se archiva la evidencia de aprobación fuera del repositorio, se completa
   `docs/release-approvals.json` con estado `approved`, nombre y fecha, y se cambia
   `CLINICAL_REVIEW_STATUS` a `aprobado` sin alterar la versión revisada.
5. Se ejecutan `npm run verify` y `npm run release:check`.
6. Se ejecuta la migración de base de datos, se despliegan las Edge Functions y se hace
   una prueba E2E en un proyecto de staging antes del despliegue de producción.

El hook `eas-build-pre-install` ejecuta la misma compuerta automáticamente para el
perfil `production`. Los builds de desarrollo y preview no quedan bloqueados.

No se debe cambiar un estado a `approved` solo para hacer pasar el build. La finalidad
de esta compuerta es impedir que una decisión humana pendiente quede disfrazada como un
problema técnico ya resuelto.
