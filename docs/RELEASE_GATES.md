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

El hook `eas-build-pre-install` ejecuta este mismo informe para el perfil `production`.
Desde el 5 de agosto de 2026 INFORMA pero NO bloquea: el dueño del producto decidió que
publicar es una decisión suya y no debe quedar detrás de un cerrojo automático. Lo que
sí aborta el build es `check-secrets`, porque una fuga de secretos no es una decisión
de negocio.

No se debe cambiar un estado a `approved` solo para hacer pasar el build. La finalidad
de esta compuerta es impedir que una decisión humana pendiente quede disfrazada como un
problema técnico ya resuelto.

## Las 22 vulnerabilidades de `npm audit` (revisadas el 22 de agosto de 2026)

`npm audit` reporta 22 (8 altas, 14 moderadas) y **ninguna se puede arreglar ni
afecta a la app publicada**. Queda escrito para que nadie tenga que volver a
averiguarlo, y para que se note si aparece una nueva.

**Las 8 altas son todas la misma:** `image-size`, dentro de `metro`. Metro es el
empaquetador: corre en el equipo de desarrollo, no viaja en el AAB. El fallo es
un bucle infinito al leer un ICNS/JXL/HEIF malformado, así que para que hiciera
daño tendría que haber una imagen hostil en nuestra propia carpeta de assets.

Y no hay a dónde actualizar: el aviso cubre `<=2.0.2`, que son **todas** las
versiones publicadas. Lo que `npm audit fix` propone —bajar a `expo@46.0.21`—
es el resolvedor de npm buscando un árbol sin esa dependencia: sería retroceder
ocho versiones mayores de SDK y romper la app entera.

**Las 14 moderadas** son el mismo patrón: `@expo/config`, `expo-constants`,
`expo-dev-client`, `xcode`, `uuid` en herramientas de build. Sus arreglos
también son degradaciones con salto de mayor.

**Lo que sí se arregló:** `nanoid` estaba por debajo de 3.3.18 y sí viaja en el
bundle (lo usa react-navigation). Fijado en `overrides`, igual que `postcss`,
`shell-quote` y `ws`.

### Qué hacer en la próxima revisión

```bash
npm audit
```

Si sale algo que **no** sea de la cadena `metro`/`image-size`/`@expo/*`, hay que
mirarlo de verdad. Si solo salen esas, no ha cambiado nada.
