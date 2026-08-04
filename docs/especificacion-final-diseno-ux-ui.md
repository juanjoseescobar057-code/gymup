# GymUp — Especificación final de diseño UX/UI y engagement responsable

**Estado:** Requisito de producto y diseño para implementación  
**Fecha:** 2026-08-03  
**Versión del documento:** 1.0  
**Repositorio revisado:** commit `194751f`  
**Audiencia:** ingeniería móvil, diseño de producto, producto, QA, analítica, contenido y revisión clínica/legal  
**Plataforma observada:** aplicación móvil Expo/React Native en Android  

---

## 1. Propósito

Este documento define cómo debe terminarse el diseño de GymUp para que la aplicación sea:

- comprensible en pocos segundos;
- sencilla durante entrenamiento, alimentación y seguimiento;
- visualmente consistente;
- accesible;
- confiable como producto relacionado con salud;
- motivadora sin culpa, presión corporal ni patrones manipulativos;
- capaz de generar engagement positivo y sostenible;
- medible mediante analítica conductual sin enviar información sensible;
- implementable y verificable por ingeniería y QA.

No es una propuesta para rediseñar GymUp desde cero. La dirección visual actual tiene valor y debe conservarse. El trabajo consiste en corregir jerarquía, contraste, navegación, estados, copy, accesibilidad y comportamiento del sistema.

## Cómo usar este documento

Este archivo funciona como contrato de diseño, no como colección de sugerencias opcionales:

1. **Producto y diseño** resuelven primero las decisiones P0 y cualquier contradicción de objetivo, promesa o modelo de negocio.
2. **Ingeniería** implementa los componentes desde el sistema visual y los estados globales; no debe copiar cada captura como una pantalla aislada.
3. **Contenido y revisión clínica** aprueban recomendaciones, mensajes de seguridad, límites y afirmaciones de resultado.
4. **Privacidad/legal** valida mercados, edades, consentimiento, retención, terceros y clasificación regulatoria antes de publicar.
5. **QA** verifica los criterios de la sección 4, la matriz de dispositivos y las tareas de usabilidad.
6. **Analítica** instrumenta únicamente la taxonomía y propiedades aprobadas; un evento nuevo que incluya datos de salud requiere revisión.

Cuando una captura contradiga este documento, prevalece este documento. Igualar píxeles sin resolver comportamiento, estados y seguridad no cuenta como terminado.

## Índice de trabajo

| Bloque | Secciones | Responsable principal |
|---|---|---|
| Fundamentos | 1–5 | Producto, diseño, contenido |
| Sistema y navegación | 6–8 | Diseño e ingeniería |
| Pantallas | 9–17 | Diseño, ingeniería y QA |
| Estados y lenguaje | 18–21 | Ingeniería, contenido y producto |
| Accesibilidad y privacidad | 22–24 | Diseño, ingeniería, privacidad/legal |
| Medición y calidad | 25–30 | Analítica, ingeniería y QA |
| Criterio de producto | 31 | Todo el equipo |
| Trazabilidad visual | Apéndices A–B | Diseño y QA |

## 2. Material visual revisado

La especificación se construyó a partir de 16 capturas del producto real:

| Imagen | Área principal |
|---:|---|
| 1 | Perfil: identidad y datos personales |
| 2 | Perfil: plan, cuenta, privacidad y sesión |
| 3 | Perfil: macros diarios y acciones de plan |
| 4 | Inicio: saludo, nutrición, hidratación y estadísticas |
| 5 | Inicio: entrenamiento, coach y accesos rápidos |
| 6 | Inicio: detalle de entrenamiento y coach |
| 7 | Progreso: misiones, meta y peso |
| 8 | Progreso: nivel, racha, XP y misiones |
| 9 | Escanear: resumen diario y tres funciones |
| 10 | Escanear: funciones y consejo del día |
| 11 | Coach: accesos, ejercicios del día y selector |
| 12 | Progreso: peso, transformación y próximos logros |
| 13 | Coach de postura: preparación de fotografía |
| 14 | Coach en vivo: selección, contador y comienzo |
| 15 | Chat: introducción, memoria y prompts sugeridos |
| 16 | Coach: catálogo de ejercicios |

Las capturas muestran estados específicos. El ingeniero debe implementar también todos los estados alternativos definidos en este documento; no basta con igualar visualmente las capturas.

## 3. Diagnóstico ejecutivo

### 3.1 Lo que debe conservarse

- Fondo oscuro como identidad principal.
- Verde neón como color de marca y acción.
- Tipografía Barlow Condensed en títulos cortos y cifras de impacto.
- Tarjetas redondeadas con estructura modular.
- CTA principales grandes.
- Personalización mediante nombre, plan y objetivo.
- Arquitectura de navegación: Inicio, Progreso, Escanear, Coach y Perfil.
- Preview del entrenamiento de hoy.
- Prompts sugeridos en el coach.
- Selección visual mediante fondo/borde de acento.
- Separación explícita de privacidad y eliminación de datos.

### 3.2 Problemas que impiden considerar terminado el diseño

1. Muchos textos secundarios no alcanzan contraste suficiente.
2. La barra inferior se superpone visualmente con la navegación de Android.
3. El botón central de cámara parece una pestaña seleccionada permanentemente.
4. La pantalla de Inicio muestra demasiados ceros antes de mostrar la acción importante.
5. Algunas pantallas convierten falta de datos en un juicio negativo.
6. La gamificación recompensa uso de funciones y no siempre comportamientos saludables.
7. Emojis heterogéneos reducen consistencia y confianza.
8. El verde se usa simultáneamente para acción, Premium, selección, éxito e información.
9. El título “Coach de postura” no representa todo el contenido de la pestaña Coach.
10. El ejercicio seleccionado puede no coincidir con el entrenamiento del día.
11. Existen promesas y mensajes excesivamente absolutos: “estás estancado”, “semana perfecta”, “en 30 días verás la diferencia”, “solo el 5%”.
12. Faltan estados bien diseñados para ausencia de datos, offline, permisos, carga, error, sincronización y bloqueo de seguridad.
13. Las instrucciones importantes suelen estar en el color de menor contraste.
14. La privacidad se comunica demasiado tarde en funciones de cámara, memoria y fotos.

## 4. Definición de terminado

Una pantalla se considera terminada solo si cumple todo lo siguiente:

- la acción principal puede identificarse en menos de cinco segundos;
- no hay texto normal por debajo de contraste 4.5:1;
- texto grande e iconografía relevante alcanzan al menos 3:1;
- ninguna instrucción necesaria usa estilo deshabilitado;
- todos los controles táctiles tienen mínimo 48 × 48 dp o hit target equivalente;
- funciona con tamaño de fuente del sistema al 200%;
- funciona con navegación Android de tres botones y por gestos;
- no hay contenido oculto por safe areas, teclado o barra inferior;
- existe estado loading, success, empty, offline, error y disabled cuando aplique;
- el estado de selección no depende solo del color;
- TalkBack/VoiceOver anuncia nombre, rol, estado y acción;
- la pantalla no presenta ausencia de datos como fracaso;
- no usa culpa, vergüenza, urgencia falsa o social proof inventado;
- la analítica necesaria está definida sin propiedades sensibles;
- los textos críticos fueron revisados en español real, no como traducción literal;
- la pantalla fue probada al menos en un dispositivo pequeño y uno grande.

## 5. Principios obligatorios de diseño conductual

### 5.1 Autonomía

GymUp debe ayudar a elegir, no ordenar. Toda recomendación importante debe ofrecer una alternativa razonable:

- sesión completa;
- versión corta;
- adaptar por molestia;
- posponer sin castigo;
- registrar manualmente en vez de usar cámara;
- usar la app sin activar analítica o notificaciones opcionales.

### 5.2 Competencia real

La sensación de progreso debe provenir de acciones significativas:

- completar una sesión programada;
- mejorar técnica;
- aumentar repeticiones o carga de forma segura;
- adaptar una sesión en vez de abandonarla;
- realizar calentamiento;
- respetar recuperación;
- completar check-in;
- mejorar una meta funcional.

No debe provenir principalmente de abrir pantallas, gastar cupos o escanear el cuerpo.

### 5.3 Relación y apoyo

El coach debe sonar como un acompañante competente:

- específico;
- calmado;
- no moralizante;
- sin estereotipos corporales;
- capaz de reconocer límites;
- dispuesto a adaptar;
- explícito sobre cuándo no sabe o cuándo hace falta un profesional.

### 5.4 Reducción de fricción

Cada pantalla debe priorizar una sola siguiente acción. La motivación no compensa una interfaz difícil. Se debe reducir:

- cantidad de decisiones simultáneas;
- necesidad de leer instrucciones largas;
- desplazamiento antes del CTA;
- repetición de la misma información;
- entradas manuales evitables;
- incertidumbre sobre guardado o sincronización.

### 5.5 Progreso sin castigo

- No usar “fallaste” para un día no completado.
- No usar “perfecto” para adherencia.
- No reiniciar el valor percibido de una semana por una interrupción.
- No mostrar 0 como fracaso cuando simplemente no hay datos.
- No activar loss aversion de manera constante mediante rachas.
- Un día de descanso prescrito cuenta como cumplimiento del plan.

### 5.6 Confianza antes de persuasión

En salud, fotos e IA, la aplicación debe explicar antes de pedir:

- qué dato necesita;
- para qué lo usará;
- qué guardará;
- qué enviará a un proveedor;
- cuánto tardará;
- cómo corregir o borrar el resultado;
- cuáles son sus límites.

## 6. Sistema visual final

### 6.1 Paleta y roles

Los valores finales deberán pasar verificación automática de contraste. La siguiente tabla define intención y valores iniciales recomendados:

| Token | Valor inicial | Uso permitido |
|---|---|---|
| `bg` | `#0E0E10` | Fondo principal |
| `surface` | `#1A1A1E` | Tarjetas |
| `surfaceElevated` | `#232328` | Modales, elementos elevados |
| `surfaceSubtle` | `#121214` | Regiones internas, gráficos vacíos |
| `border` | `#34343B` | Separadores y bordes normales |
| `borderStrong` | `#4A4A52` | Controles, foco, inputs |
| `accent` | `#C8FF3E` | CTA principal y selección activa |
| `accentPressed` | `#A8D92F` | Estado presionado |
| `accentSurface` | `rgba(200,255,62,0.10)` | Fondo de selección |
| `textPrimary` | `#F7F7F8` | Títulos, valores y body importante |
| `textSecondary` | `#B3B3BA` | Descripciones e instrucciones |
| `textTertiary` | `#96969F` | Metadata secundaria legible |
| `textDisabled` | `#686870` | Solo controles realmente deshabilitados |
| `info` | `#55B6FF` | Información neutral |
| `success` | `#7FE36A` | Éxito confirmado |
| `warning` | `#FFB454` | Advertencia reversible |
| `error` | `#FF6262` | Error o acción destructiva |
| `premium` | `#B88CFF` | Premium y monetización |

Reglas:

- `textDisabled` no se usa para instrucciones.
- Verde no se usa para Premium.
- Un borde verde indica selección o foco, no una tarjeta normal.
- Los resultados de macros pueden mantener azul/naranja, pero no deben depender solo del color.
- Rojo queda reservado para error, peligro o eliminación.

### 6.2 Tipografía

| Estilo | Familia | Tamaño base | Line height | Uso |
|---|---|---:|---:|---|
| Display | Barlow Condensed Black | 40 | 44 | Título principal corto |
| H1 | Barlow Condensed ExtraBold | 34 | 38 | Pantallas utilitarias |
| H2 | Barlow Condensed Bold | 26 | 31 | Tarjetas hero |
| H3 | DM Sans SemiBold | 20 | 26 | Títulos de tarjetas |
| Body large | DM Sans Regular | 17 | 25 | Mensajes principales |
| Body | DM Sans Regular | 16 | 23 | Contenido normal |
| Body small | DM Sans Regular | 14 | 20 | Metadata útil |
| Caption | DM Sans Medium | 13 | 18 | Labels cortos |
| Tab label | DM Sans SemiBold | 12 | 16 | Barra inferior |
| Numeric display | Barlow Condensed Black | 48–56 | 52–60 | Peso, reps, score |

Reglas:

- No usar texto de 8–11 px para información que el usuario deba leer.
- El mínimo funcional es 12 px; se prefiere 13–14 px.
- Todos los estilos deben respetar `fontScale`.
- No limitar altura de texto cuando el sistema aumente tamaño.
- Barlow Condensed se reserva para titulares, cifras y CTA; no para párrafos.

### 6.3 Espaciado

Usar escala: `4, 8, 12, 16, 24, 32, 40`.

- Margen lateral móvil: 20–24 dp.
- Padding de tarjeta: mínimo 16 dp.
- Separación entre secciones: 28–32 dp.
- Separación título/descripción: 6–8 dp.
- Separación entre CTA primario y secundario: 12 dp.
- No crear espacios vacíos verticales sin propósito de jerarquía.

### 6.4 Tarjetas

- Radio estándar: 18–20 dp.
- Borde normal: 1 dp `border`.
- Borde seleccionado: 1.5–2 dp `accent`.
- Fondo seleccionado: `accentSurface`.
- No aplicar borde verde a todas las tarjetas.
- Tarjetas accionables deben tener estado pressed y accesibilidad de botón.
- Toda la superficie de una tarjeta accionable debe ser tocable.

### 6.5 Botones

#### Primario

- Fondo verde sólido.
- Texto oscuro con contraste alto.
- Altura: 54–58 dp.
- Verbo específico: “Iniciar entrenamiento”, no “Continuar”.
- Solo uno por viewport salvo confirmación/destrucción.

#### Secundario

- Fondo transparente o superficie elevada.
- Borde `borderStrong`.
- Texto `textPrimary`.

#### Destructivo

- Rojo solo para eliminar o acción irreversible.
- Cerrar sesión es neutral, salvo cuenta anónima no recuperable; en ese caso se explica el riesgo en el modal, no mediante color rojo permanente.

#### Estados

- `pressed`: cambio visible de fondo/escala leve.
- `loading`: label explícito y spinner; se conserva ancho.
- `disabled`: contraste diferenciado, no interactivo, con motivo disponible.
- `success`: confirmación breve, no sustituir navegación necesaria.
- `error`: mensaje asociado, no solo toast genérico.

### 6.6 Iconografía

- Reemplazar emojis usados como iconos funcionales por un set vectorial consistente.
- Mantener emojis únicamente en celebraciones o contenido conversacional.
- Ejercicios deben usar siluetas anatómicas coherentes.
- Tamaño estándar: 20–24 dp; hero: 32–40 dp.
- Todo icono sin texto debe tener label accesible.
- No mezclar inglés visual como “BACK” o “TOP”.

### 6.7 Movimiento y haptics

- Animaciones de 150–250 ms.
- Evitar rebotes continuos o urgencia artificial.
- Respetar `reduceMotion`.
- Haptic ligero al seleccionar.
- Haptic de éxito al completar una acción real.
- No usar haptic de error para metas no alcanzadas.

## 7. Navegación inferior

### 7.1 Arquitectura

Orden recomendado:

1. Inicio.
2. Progreso.
3. Escanear — acción central elevada.
4. Coach.
5. Perfil.

### 7.2 Requisitos

- La pestaña activa debe tener icono y label en `accent` o `textPrimary`.
- Las demás usan `textSecondary`, no `textDisabled`.
- El botón central debe incluir label “Escanear”.
- Su forma debe comunicar que es una acción especial, no la pestaña activa permanente.
- Debe respetar `safeAreaInsets.bottom`.
- Debe probarse con navegación Android de tres botones, gestos y diferentes densidades.
- Ningún contenido debe quedar debajo de la barra.
- En Coach en vivo y sesión de entrenamiento puede ocultarse para reducir distracciones.

## 8. Arquitectura de información

### Inicio

Debe responder: “¿Cuál es mi siguiente mejor acción hoy?”.

### Progreso

Debe responder: “¿Qué ha cambiado realmente y qué debería hacer después?”.

### Escanear

Debe responder: “¿Qué quiero registrar o analizar?”.

### Coach

Debe responder: “¿Necesito conversar, revisar técnica o entrenar en vivo?”.

### Perfil

Debe responder: “¿Qué información, preferencias, salud y privacidad controla mi cuenta?”.

## 9. Especificación de Inicio

### 9.1 Orden final

1. Saludo compacto y avatar.
2. Tarjeta “Tu siguiente acción”.
3. Alternativas contextuales.
4. Resumen nutrición/hidratación compacto.
5. Insight de progreso, solo si hay evidencia.
6. Coach contextual breve.
7. Accesos secundarios.

### 9.2 Tarjeta de siguiente acción

Debe mostrar:

- nombre de sesión;
- duración estimada;
- cantidad de ejercicios;
- estado: programada, en progreso o completada;
- CTA principal;
- opción “Solo tengo 20 min”;
- opción “Tengo una molestia”;
- opción “Cambiar ejercicio”.

Copy sugerido:

> Pecho + tríceps  
> 4 ejercicios · aproximadamente 55 min  
> **Iniciar entrenamiento**

No usar `55'`; usar `55 min`.

### 9.3 Cold start

No mostrar una pared de ceros. Cuando aún no hay actividad:

- ocultar comparaciones mensuales;
- mostrar “Comienza tu primera semana”;
- explicar una acción pequeña;
- no mostrar flecha verde `↑0%`;
- distinguir “sin registrar” de “cero”.

### 9.4 Nutrición

- “No registrado” cuando no hay comidas.
- Nunca inferir que consumió 0 kcal.
- Mostrar progreso como rango, no perfección exacta.
- El resumen debe poder plegarse.
- Añadir acceso a registro manual.

### 9.5 Hidratación

- Las gotas deben mostrar claramente que son controles.
- Permitir `+1 vaso` como acción principal.
- Permitir deshacer.
- No usar una meta fija universal sin explicación.
- No castigar días sin registro.

### 9.6 Comparación mensual

Solo mostrar si existen periodos comparables.

Estados:

- `insufficient_data`: “Necesitamos más actividad para comparar”.
- `stable`: mostrar diferencia neutral.
- `improved`: verde con explicación.
- `decreased`: texto neutral, no rojo automático.

### 9.7 Coach en Home

Máximo tres líneas antes de “Ver más”. Debe aportar algo nuevo.

Buen ejemplo:

> Hoy tienes pecho y tríceps. Empieza con una carga cómoda y deja 2–3 repeticiones en reserva. Si tienes poco tiempo, puedo reducir la sesión.

Evitar:

- “Dale fuerte”.
- “Sin excusas”.
- repetir literalmente el nombre de la sesión sin recomendación.

## 10. Especificación de entrenamiento

### 10.1 Preview

- Mostrar tres ejercicios y `+N más` es correcto.
- La lista completa debe abrirse sin abandonar el contexto.
- “Biblioteca de ejercicios” debe tener contraste de enlace normal.
- El CTA debe permanecer accesible; puede ser sticky en pantallas pequeñas.

### 10.2 Semana y plan

No usar “Día 1 de 7” si solo hay tres sesiones. Usar:

- “Semana 1 · Sesión 1 de 3”; o
- “Hoy · Pecho y tríceps”.

Un día de descanso debe aparecer como “Recuperación programada”, no como tarea incompleta.

### 10.3 Durante la sesión

Debe priorizar:

- ejercicio actual;
- serie actual;
- peso/repeticiones;
- descanso;
- técnica;
- pausar;
- terminar;
- reportar dolor.

Debe existir guardado visible:

- “Guardando…”;
- “Guardado”; 
- “Sin conexión · se sincronizará después”; 
- “No se pudo guardar · reintentar”.

### 10.4 Finalización

Aplicar peak-end rule responsable:

- celebrar completar o adaptar;
- resumir resultados reales;
- pedir RPE, dolor y energía;
- mostrar próxima sesión;
- evitar comparación corporal inmediata;
- no declarar éxito antes de confirmar persistencia.

## 11. Especificación de Progreso

### 11.1 Propósito

Progreso no debe ser un tablero de uso. Debe diferenciar:

- resultados observados;
- adherencia;
- estimaciones;
- información insuficiente.

### 11.2 Estado inicial

En lugar de múltiples ceros:

> Tu primera semana empieza hoy. Completa una acción pequeña para crear tu línea base.

Mostrar máximo una o dos acciones sugeridas.

### 11.3 Peso

- Una medición no crea tendencia.
- Dos mediciones permiten una línea, no una conclusión fuerte.
- Usar al menos varias mediciones y periodo suficiente antes de “estable”, “subiendo” o “bajando”.
- Mostrar incertidumbre.
- Recomendar condiciones similares de medición.
- Nunca usar “estancado” sin evidencia suficiente.

Copy sin datos:

> Estamos construyendo tu línea base. Registra otro peso en condiciones similares para empezar a ver la tendencia.

Copy estable:

> Tu peso se ha mantenido dentro de un rango similar. Antes de ajustar, revisemos adherencia, energía y entrenamiento.

### 11.4 Conflicto de objetivos

Si `goal = muscle_gain` y el peso objetivo implica una reducción importante, mostrar una reconciliación:

> Tu objetivo de peso implica bajar 7 kg, mientras que tu objetivo principal es ganar músculo. ¿Qué quieres priorizar?

Opciones:

- ganar músculo;
- recomposición corporal;
- bajar peso;
- no usar meta de peso.

No continuar mostrando recomendaciones contradictorias.

### 11.5 Progreso funcional

Añadir métricas relevantes:

- mejor serie;
- volumen tolerado;
- repeticiones;
- consistencia con sesiones programadas;
- sesiones adaptadas;
- técnica;
- energía;
- dolor;
- recuperación.

Peso y fotos son opcionales, nunca la única medida.

### 11.6 Rachas

- Racha se calcula respecto a sesiones programadas, no apertura diaria.
- Descanso programado mantiene cumplimiento.
- Permitir pausar por viaje, enfermedad, menstruación, embarazo o lesión sin penalización.
- El comodín no debe explotar miedo a perder progreso.
- Si no hay XP suficiente, el botón de compra aparece deshabilitado con motivo.

### 11.7 Misiones

Eliminar o rediseñar:

- “Registra 10 comidas”.
- “Hazte 1 análisis corporal”.

Reemplazar por:

- completa las sesiones programadas;
- realiza el calentamiento;
- completa un check-in de recuperación;
- registra cómo te sentiste después de entrenar;
- adapta una sesión cuando tengas poco tiempo;
- respeta un día de recuperación;
- prepara una comida alineada con tu objetivo, sin llamarla perfecta.

### 11.8 Logros

Eliminar:

- “Semana perfecta”.
- “7 días sin fallar”.
- “Solo el 5% llega aquí” salvo evidencia real, revisada y necesaria.

Usar:

- “Semana consistente”.
- “Completaste lo programado”.
- “Adaptaste tu plan responsablemente”.
- “Primera revisión de progreso”.

Logros bloqueados siguen siendo legibles y explican cómo obtenerse.

### 11.9 Fotos de transformación

Reemplazar:

> En 30 días verás la diferencia.

Por:

> Compara tus fotos dentro de 30 días con iluminación, distancia y postura similares. Los cambios visibles varían entre personas.

Antes de capturar:

- dónde se almacena;
- quién puede verla;
- cómo eliminarla;
- si se envía o no a IA;
- consentimiento explícito.

## 12. Especificación de Escanear

### 12.1 Jerarquía

Orden recomendado:

1. Título y descripción breve.
2. Tres funciones.
3. Resumen compacto del día.
4. Consejo contextual.

La acción principal no debe quedar desplazada por un dashboard.

### 12.2 Tarjetas

Toda la tarjeta es accionable. Debe mostrar:

- icono consistente;
- nombre;
- descripción;
- disponibilidad;
- Premium cuando corresponda;
- flecha o CTA textual;
- estado loading/disabled.

### 12.3 Cupos

Usar lenguaje neutral:

- “3 análisis disponibles hoy”.
- “1 análisis disponible hoy”.

Evitar enfatizar escasez como incentivo. Al agotarse:

- explicar cuándo se renueva;
- ofrecer registro manual cuando aplique;
- mostrar Premium sin presión engañosa.

### 12.4 Comida

Flujo:

1. Explicación de cámara/galería/manual.
2. Captura.
3. Estado de análisis.
4. Resultado editable.
5. Confirmación.
6. Guardado/sincronización.

El resultado debe permitir editar:

- ingredientes;
- porción;
- gramos;
- calorías;
- macros.

Debe mostrar que es una estimación y permitir “No coincide”.

### 12.5 Nevera

- Explicar qué ingredientes detectó.
- Permitir agregar/eliminar ingredientes antes de crear recetas.
- No insinuar precisión absoluta.
- Separar claramente ingredientes disponibles y sugeridos para comprar.

### 12.6 Análisis corporal

- Premium usa color `premium`, no verde de acción.
- No incentivar mediante XP.
- Explicar limitaciones antes de foto.
- No prometer porcentaje de grasa preciso.
- Permitir omitirlo sin degradar experiencia principal.

### 12.7 Consejo del día

No decir:

> Llevas 0 kcal y 0 g de proteína.

Cuando no existen registros, usar:

> Aún no has registrado comidas hoy. Puedes tomar una foto o añadir una manualmente.

## 13. Especificación de Coach

### 13.1 Nombre e información

La pestaña debe titularse `COACH`, no `COACH DE POSTURA`, porque contiene:

- coach en vivo;
- chat;
- análisis de postura por foto;
- ejercicios del día;
- catálogo.

### 13.2 Orden

1. Recomendación contextual para hoy.
2. Coach en vivo.
3. Hablar con el coach.
4. Analizar técnica de una foto.
5. Ejercicios de hoy.
6. Recientes.
7. Catálogo completo.

### 13.3 Selección de ejercicio

- Si llega desde entrenamiento, preseleccionar ese ejercicio.
- Si llega desde Coach y hay sesión de hoy, preseleccionar el primer ejercicio de hoy.
- Si no existe contexto, no seleccionar arbitrariamente.
- El nombre, icono y grupos musculares deben coincidir.
- Nunca seleccionar sentadilla si la sesión activa es pecho sin explicar el cambio.

### 13.4 Catálogo

- Reemplazar emojis por siluetas.
- Añadir buscador.
- Añadir filtros por grupo muscular y equipo.
- Mostrar “Ejercicios de hoy” y “Recientes” primero.
- Virtualizar la lista.
- Evitar idiomas mezclados.

## 14. Especificación de análisis de postura por foto

### 14.1 Preparación

Reducir las instrucciones iniciales a tres pasos visibles:

1. Coloca el teléfono a una distancia suficiente.
2. Muestra el cuerpo completo.
3. Haz el movimiento sin peso o con carga cómoda.

El resto aparece en “Consejos para mejorar el análisis”.

### 14.2 Seguridad

- No pedir que sostenga una posición difícil con carga para obtener la foto.
- Priorizar demostración sin peso.
- Si existe dolor, no pedir repetir el movimiento.
- Añadir “Detente si sientes dolor”.
- La captura no sustituye evaluación profesional.

### 14.3 Confianza

Reemplazar:

> La IA detectará si el ejercicio no es visible.

Por:

> La app intentará comprobar que tu cuerpo y el movimiento sean visibles antes de analizar.

### 14.4 Cámara

- Overlay de silueta.
- Indicador de cuerpo completo.
- Indicador de iluminación.
- Temporizador.
- Repetir foto.
- Galería como alternativa.
- Disclosure de tratamiento antes del permiso del sistema.

## 15. Especificación de Coach en vivo

### 15.1 Preflight obligatorio

Antes de habilitar “Empezar”:

- preview de cámara;
- cuerpo completo detectado;
- iluminación suficiente;
- distancia orientativa;
- ejercicio seleccionado;
- procesamiento local/remoto explicado;
- audio configurado;
- espacio seguro confirmado.

Estados:

- `no_person`;
- `partial_body`;
- `too_close`;
- `too_far`;
- `low_light`;
- `ready`;
- `camera_denied`;
- `model_unavailable`;
- `device_not_supported`.

### 15.2 Durante la sesión

Mostrar:

- reps;
- fase actual;
- una corrección prioritaria;
- estado de detección;
- pausar;
- detener;
- silenciar;
- reportar dolor.

No mostrar varias correcciones simultáneas.

### 15.3 Audio

El icono debe tener label y estado:

- “Indicaciones por voz activadas”.
- “Silenciar indicaciones”.

### 15.4 Finalización

- Resumen de reps observadas.
- Advertir si la detección fue incompleta.
- Máximo tres cues de técnica.
- Pedir valoración de utilidad.
- Permitir reportar resultado incorrecto.
- No convertir observación de técnica en diagnóstico de lesión.

## 16. Especificación del chat

### 16.1 Layout inicial

- Eliminar el gran vacío vertical observado.
- Acercar introducción y prompts al header.
- Mantener input visible sin cubrir contenido.
- Ajustar al teclado y safe area.

### 16.2 Header

No usar `meta -7.0 kg`. Mostrar una frase inequívoca:

- “Objetivo: llegar a 55 kg”; o
- “Objetivo: ganar músculo”; o
- “Objetivo: recomposición corporal”.

Si hay contradicción entre objetivos, resolver antes de usarla como contexto.

### 16.3 Mensaje inicial

Versión recomendada:

> ¡Hola, Mane! Conozco tu plan y el progreso que registras. Puedo ayudarte a adaptar una sesión, revisar molestias generales o planear una comida. No sustituyo a un profesional de salud.

### 16.4 Memoria

Junto a “recordaré lo que me cuentes” debe existir:

- “Ver memoria”.
- “Editar”.
- “Eliminar”.
- Explicación de almacenamiento.
- Estado de memoria activada/desactivada.

### 16.5 Prompts sugeridos

Conservar y priorizar:

- “Estoy adolorido, ¿entreno hoy?”.
- “Solo tengo 20 minutos”.
- “¿Cómo llego a mi meta de proteína?”.
- “¿Voy bien hacia mi meta?”.

Adaptarlos al contexto. Si hoy es descanso, no sugerir entrenar sin motivo.

### 16.6 Cupo

El cupo gratuito no debe dominar el header. Mostrarlo de forma secundaria cerca del input:

> 5 mensajes disponibles hoy.

Al quedar uno, no usar urgencia falsa. Al agotarse, mantener acceso al historial y opciones de seguridad.

### 16.7 Estados

- escribiendo;
- enviando;
- respuesta parcial;
- timeout;
- sin conexión;
- límite alcanzado;
- respuesta reportada;
- contenido de seguridad;
- escalamiento a profesional.

El botón de envío debe comunicar claramente disabled/active.

## 17. Especificación de Perfil

### 17.1 Hero

- Reducir altura entre 25% y 30%.
- Clarificar nombre versus apodo.
- Mantener objetivo como badge.
- Mantener Editar visible.
- El botón de ayuda debe tener propósito explícito.

### 17.2 Datos personales

- Labels en `textSecondary`.
- Valores en `textPrimary`.
- Evitar información cortada por barra inferior.
- Indicar qué campos son estimaciones o afectan cálculos.
- Explicar por qué se pregunta sexo biológico y permitir no informarlo.

### 17.3 Macros

- Presentarlos como estimación o rango.
- Unidades legibles.
- “Cómo se calcula”.
- Fecha de última actualización.
- No usar exactitud visual que exceda la precisión real.

### 17.4 Plan

Acciones habilitadas usan texto blanco. Si son Premium:

- badge Premium;
- explicación;
- no apariencia de disabled.

Reiniciar al día 1 requiere confirmación y explicación de consecuencias.

### 17.5 Cuenta anónima

Convertir “Guardar mi progreso” en una prioridad visual:

> Protege tu progreso  
> Añade un correo para recuperarlo en otro dispositivo.

No esperar hasta logout para explicar el riesgo.

### 17.6 Privacidad y datos

Añadir:

- Centro de privacidad.
- Preferencias de analítica.
- Preferencias de replay si continúa existiendo.
- Descargar mis datos.
- Gestionar memoria del coach.
- Gestionar fotos.
- Política de privacidad.
- Términos.
- Gestionar suscripción.
- Eliminar cuenta.

### 17.7 Cerrar sesión

- Estilo neutral.
- Si es cuenta anónima, explicar el riesgo en confirmación.
- Cancelar notificaciones y limpiar datos locales según política.

## 18. Estados globales obligatorios

### 18.1 Loading

- Skeleton con forma del contenido.
- No mostrar ceros mientras carga.
- Mantener layout estable.
- Texto de progreso solo en operaciones largas.

### 18.2 Empty

Un estado vacío incluye:

- qué falta;
- por qué sirve;
- una sola acción;
- ninguna evaluación negativa.

### 18.3 Offline

- Banner no bloqueante.
- Indicar qué funciona.
- Mostrar contenido cacheado con timestamp.
- Acciones mutables quedan “pendientes”.
- Reintento manual disponible.

### 18.4 Error

- Mensaje en lenguaje humano.
- Acción concreta.
- No culpar al usuario.
- No mostrar error técnico crudo.
- Conservar entrada/foto cuando sea seguro.

### 18.5 Permiso denegado

- Explicar por qué se necesita.
- Alternativa manual o galería cuando exista.
- Botón para abrir Ajustes.
- No pedir repetidamente en cada visita.

### 18.6 Premium bloqueado

- Mostrar valor y límites reales.
- No simular que el botón está roto.
- Permitir cerrar.
- Mantener alternativas gratuitas.

### 18.7 Cuota agotada

- Fecha/hora de renovación comprensible.
- No borrar resultados existentes.
- No bloquear ayuda de seguridad.
- Ofrecer manual o espera.

### 18.8 Bloqueo de salud

- Diferenciar emergencia de revisión profesional.
- No usar modal genérico.
- No ofrecer CTA de “entrenar de todas formas”.
- Ofrecer acción segura y contexto.

## 19. Copy y tono

### 19.1 Personalidad

GymUp debe ser:

- directo;
- cálido;
- competente;
- energético cuando corresponde;
- conservador ante salud;
- respetuoso con autonomía;
- libre de moralización corporal o alimentaria.

### 19.2 Expresiones prohibidas o a reemplazar

| Evitar | Usar |
|---|---|
| Estás estancado | Tu tendencia se ha mantenido estable / aún faltan datos |
| Semana perfecta | Semana consistente |
| 7 días sin fallar | Completaste lo programado |
| Solo el 5% llega aquí | Has mantenido dos semanas de consistencia |
| En 30 días verás la diferencia | Compara dentro de 30 días; los cambios varían |
| No tienes que querer hacerlo | ¿Qué versión de la sesión te funciona hoy? |
| La cama miente | Descansar y entrenar son partes del progreso |
| Dale fuerte | Empieza con una carga cómoda y técnica estable |
| Lo que no se mide no mejora | Registrar puede ayudarte a observar tendencias |
| Te quedan 3 | Tienes 3 disponibles |
| Macros perfectos | Rango de adherencia / metas cubiertas |

### 19.3 Reglas

- No usar “fracaso”, “fallar”, “culpa” o “arrepentimiento” como motivador.
- No comparar al usuario con otros.
- No prometer resultados en fechas absolutas.
- No describir estimaciones de IA como mediciones.
- No tratar alimentos como buenos/malos.
- No tratar dolor de entrenamiento como obligación.
- Usar verbos claros en CTA.

## 20. Engagement positivo

### 20.1 Loop principal

1. **Cue:** mostrar la siguiente acción relevante.
2. **Ability:** ofrecer versión realizable según tiempo y estado.
3. **Action:** completar una acción pequeña.
4. **Feedback:** confirmar guardado y progreso específico.
5. **Reflection:** preguntar esfuerzo, dolor y utilidad.
6. **Adaptation:** ajustar próxima recomendación.

### 20.2 Primera semana

#### Día 0

- Generar primera sesión.
- Explicar una única acción.
- Proteger cuenta anónima después de mostrar valor, no antes.

#### Después de primera sesión

- Celebración breve.
- Resumen específico.
- Check-in.
- Próximo paso.

#### Primer retorno

- Recordar lo logrado.
- No abrir con ceros.
- Mostrar continuidad.

#### Día 7

- Revisión semanal.
- Qué funcionó.
- Qué adaptar.
- Sin premio por uso compulsivo.

### 20.3 Guardrails

El engagement no puede aumentar a costa de:

- dolor;
- ejercicio excesivo;
- escaneos corporales innecesarios;
- registro obsesivo de comida;
- miedo a perder racha;
- culpa por descanso;
- notificaciones no deseadas;
- compartir más datos de los necesarios.

## 21. Notificaciones

### 21.1 Principios

- Opt-in contextual.
- Frecuencia configurable.
- Quiet hours.
- Respetar plan y descanso.
- Cancelar al cerrar sesión/eliminar cuenta.
- No enviar si la acción ya fue completada.
- No usar comparación social o vergüenza.

### 21.2 Ejemplos aceptables

> Hoy tienes una sesión programada. ¿Quieres hacer la versión completa o una de 20 minutos?

> Hoy es recuperación. Un paseo suave o descanso completo también cuenta.

> Hace unos días que no entrenas. Cuando quieras volver, podemos empezar con algo corto.

### 21.3 Preferencias

- Entrenamientos.
- Comidas.
- Agua.
- Check-in semanal.
- Progreso.
- Reactivación.
- Horario.
- Frecuencia.
- Pausar todo.

## 22. Accesibilidad

### 22.1 Visual

- WCAG AA como mínimo.
- Body normal: 4.5:1.
- Texto grande: 3:1.
- Elementos no textuales: 3:1.
- No depender solo de verde/rojo.
- Foco visible.
- Zoom/texto 200% sin pérdida.

### 22.2 Motora

- Target mínimo 48 dp.
- Espacio suficiente entre targets.
- Alternativas a gestos.
- Acciones destructivas con confirmación.
- Botones importantes accesibles con una mano.

### 22.3 Lectores de pantalla

Cada elemento informa:

- nombre;
- rol;
- estado;
- valor;
- hint solo cuando aporta algo.

Ejemplo:

> “Plan anual, 79,99 dólares por año, seleccionado, botón de opción”.

### 22.4 Cognitiva

- Una acción primaria.
- Lenguaje literal.
- Evitar siglas sin explicación.
- No sobrecargar con métricas.
- Confirmar cambios importantes.
- Mantener patrones de navegación.

### 22.5 Auditiva

- Cues por voz siempre tienen representación visual/haptic.
- Coach en vivo funciona con audio silenciado.

## 23. Privacidad visible y confianza

Antes de cámara, chat o fotos mostrar disclosure breve:

1. Qué se captura.
2. Si sale del dispositivo.
3. Si se almacena.
4. Durante cuánto tiempo.
5. Cómo borrarlo.

No usar documentos legales como sustituto del disclosure contextual.

### 23.1 Session replay

Si continúa:

- opt-in separado;
- off por defecto en datos sensibles;
- exclusión de Progreso, Perfil, Historial, Coach, Salud, entrenamientos y fotos;
- indicador en Centro de privacidad;
- opción de retiro.

### 23.2 Analítica

No enviar:

- condiciones;
- lesiones;
- peso exacto;
- macros exactos;
- mensajes;
- fotos;
- nombres de ejercicios asociados con lesión;
- texto de errores upstream.

## 24. Puertas de cumplimiento normativo y tiendas

Esta sección traduce obligaciones de alto nivel a decisiones visibles de producto. No sustituye concepto jurídico ni clínico. Antes de cada mercado se debe documentar país, público objetivo, edad mínima, finalidad prevista, claims y flujo real de datos.

### 24.1 Accesibilidad verificable

- Adoptar [WCAG 2.2](https://www.w3.org/WAI/WCAG22/understanding/) nivel AA como línea base de contraste, uso de color, reflow, texto ampliado y controles.
- En Android, garantizar targets de al menos 48 × 48 dp conforme a la [guía oficial de accesibilidad](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).
- En iOS, usar como referencia los controles frecuentes de 44 × 44 pt y las recomendaciones de contraste, texto adaptable, movimiento y pistas multimodales de las [Human Interface Guidelines de accesibilidad](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- Guardar evidencia de pruebas con Accessibility Scanner, TalkBack, Accessibility Inspector y VoiceOver.
- Una excepción visual no puede reducir el área táctil; ampliar `hitSlop` cuando el icono deba verse pequeño.

### 24.2 Datos de salud en Colombia

Peso, lesiones, condiciones, fotos corporales, inferencias posturales y ciertos resultados derivados pueden constituir datos sensibles. La [Superintendencia de Industria y Comercio](https://www.sic.gov.co/boletin-juridico-abril-2017/tratamiento-de-los-datos-sensibles-en-casos-relativos-a-la-salud) recuerda que el tratamiento de datos sensibles de salud normalmente requiere autorización explícita.

Requisitos de diseño:

- consentimiento separado, informado, demostrable y no premarcado;
- explicar finalidad concreta antes de pedir el dato;
- indicar si suministrarlo es opcional y qué función se pierde al negarse;
- separar aceptación de términos, marketing, analítica y tratamiento sensible;
- permitir revocar autorización y solicitar eliminación desde la app;
- mostrar retención y terceros reales, no categorías vagas;
- no reutilizar fotos, mensajes o inferencias para publicidad o entrenamiento de modelos sin una base y autorización específicas;
- conservar comprobante versionado del texto aceptado, sin exponer el dato de salud en telemetría.

La interfaz debe reflejar la operación real del backend. Un copy correcto no compensa una retención, transferencia o eliminación incorrecta.

### 24.3 Frontera entre fitness y dispositivo médico

El [INVIMA indica](https://www.invima.gov.co/node/184) que una aplicación puede considerarse dispositivo médico según su uso, aplicación y finalidad prevista. Antes de lanzar Coach de postura, detección de lesiones o recomendaciones asociadas con dolor, producto y asesoría regulatoria deben fijar por escrito la finalidad prevista.

Hasta completar esa evaluación, la app:

- no diagnostica lesiones, enfermedades o deficiencias;
- no afirma prevenir, tratar, curar o rehabilitar una condición;
- no promete que una corrección automática evita lesiones;
- no presenta estimaciones visuales como mediciones clínicas;
- no comunica porcentajes de precisión sin protocolo y evidencia;
- distingue “señal no visible”, “estimación incierta” y “posible ajuste técnico”;
- deriva a profesional cualificado ante dolor intenso, trauma, pérdida de fuerza, mareo u otra señal de alarma definida clínicamente;
- aclara que no sirve para emergencias.

Un disclaimer no neutraliza una funcionalidad que en la práctica diagnostique o trate. Si cambia la finalidad prevista, se reabre la evaluación regulatoria antes de diseñar el claim o publicar la función.

### 24.4 Google Play

GymUp entra en la categoría de salud y fitness. Antes del release se debe:

- completar correctamente la declaración de Health Apps;
- publicar una política de privacidad activa, pública, accesible dentro de la app y coherente con Data Safety;
- mostrar disclosure prominente antes de permisos o recolección sensible;
- pedir únicamente permisos necesarios para una función visible;
- declarar con precisión actividad/fitness, nutrición/peso y cualquier otra categoría aplicable;
- alinear descripción de tienda, onboarding y comportamiento real;
- incluir la declaración de no ser dispositivo médico y la recomendación de consultar a un profesional cuando corresponda;
- aportar evidencia regulatoria si finalmente se presenta como dispositivo médico.

Fuente operativa: [Política de contenido y servicios de salud de Google Play](https://support.google.com/googleplay/android-developer/answer/16679511).

### 24.5 App Store

Las [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) exigen especial cuidado en funcionalidades médicas, exactitud de mediciones, privacidad y datos de salud. El release de iOS debe verificar:

- metodología y limitaciones visibles para cada medición o inferencia;
- política de privacidad accesible dentro de la app;
- datos recopilados, terceros, retención, revocación y eliminación claramente descritos;
- no usar datos de salud/fitness para publicidad o minería de marketing;
- coherencia entre permisos, App Privacy y comportamiento real;
- derivación a profesional antes de decisiones médicas;
- no almacenar información personal de salud en mecanismos incompatibles con la política de Apple.

### 24.6 Edad, mercados y expansión

- Definir si el producto es exclusivamente para mayores de edad. El diseño actual no resuelve uso por menores.
- Si se admiten menores, detener el lanzamiento de fotos corporales, chat, personalización nutricional y analítica sensible hasta contar con evaluación específica, consentimiento aplicable y salvaguardas de edad.
- Antes de operar en la Unión Europea, revisar GDPR y, según los claims, MDR; antes de Estados Unidos, revisar leyes estatales de privacidad y el marco aplicable a health apps.
- No usar geolocalización inferida como sustituto del mercado contractual o residencia relevante.

### 24.7 Expediente mínimo de evidencia

Mantener versionado, por release:

- inventario de claims en app, web y tiendas;
- finalidad prevista y público objetivo;
- fuentes clínicas y fecha de revisión;
- validación de recomendaciones y límites;
- métricas del modelo por ejercicio, dispositivo, iluminación y tipo corporal;
- umbrales de incertidumbre y abstención;
- matriz de datos: origen, finalidad, destino, retención y eliminación;
- proveedores y transferencias;
- textos de consentimiento/disclosure con versión;
- pruebas de accesibilidad;
- plan de incidentes y escalamiento de contenido dañino;
- responsables que aprobaron producto, clínica, privacidad y seguridad.

### 24.8 Gate de salida

El release queda bloqueado si ocurre cualquiera de estos casos:

- privacidad o consentimiento describen algo distinto a la implementación;
- existe un claim médico sin evidencia/aprobación;
- una inferencia insegura se presenta con certeza;
- cámara, fotos o memoria funcionan antes del disclosure aplicable;
- no es posible revocar consentimiento o borrar los datos prometidos;
- las declaraciones de tiendas están incompletas;
- no se decidió política de edad;
- QA no puede demostrar contraste, targets, lector de pantalla y texto ampliado.

## 25. Behavioral analytics

### 25.1 North Star

**Weekly Safe Progress Users:** usuarios que completan acciones programadas/adaptadas durante la semana, registran check-in y no reportan señales de deterioro atribuibles al plan.

No usar tiempo en pantalla, cantidad de escaneos o mensajes como North Star.

### 25.2 Métricas principales

- tiempo hasta primera acción útil;
- inicio de sesión programada;
- primera serie completada;
- sesión completada o adaptada;
- check-in postentrenamiento;
- regreso a próxima sesión programada;
- uso de sesión corta;
- tasa de adaptación por molestia;
- finalización de segunda medición antes de mostrar tendencia;
- corrección de resultados de comida;
- rechazo de permisos;
- abandono en paywall;
- desactivación de notificaciones;
- reporte de contenido incorrecto.

### 25.3 Funnels

#### Entrenamiento

`home_view → workout_card_view → workout_started → first_set_saved → workout_completed → checkin_completed`

#### Comida

`scan_hub_view → food_scan_selected → disclosure_accepted → photo_selected → result_reviewed → result_edited? → food_saved`

#### Postura

`coach_view → exercise_selected → posture_mode_selected → preflight_ready → analysis_started → result_viewed → result_helpful`

#### Chat

`coach_chat_opened → suggestion_selected|message_started → message_sent → response_received → response_helpful|reported`

#### Progreso

`progress_view → weight_add_started → weight_saved → second_measurement_saved → trend_viewed`

### 25.4 Propiedades permitidas

- pantalla;
- feature;
- estado del flujo;
- fuente de entrada;
- duración redondeada;
- éxito/error categorizado;
- premium boolean;
- tipo de dispositivo agregado;
- variante de experimento.

No incluir valores de salud o contenido libre.

### 25.5 Experimentos responsables

1. Dashboard de ceros vs. siguiente acción.
2. “Estancado” vs. “datos insuficientes/tendencia estable”.
3. Misiones de uso vs. misiones de adherencia segura.
4. Coach largo vs. recomendación corta.
5. Cupo visible al entrar vs. visible después de seleccionar.
6. “Semana perfecta” vs. “semana consistente”.
7. Sesión completa solamente vs. completa + versión corta.

Guardrails obligatorios:

- dolor reportado;
- abandono tras romper racha;
- borrado de cuenta;
- opt-out de notificaciones;
- escaneos excesivos;
- reportes de respuesta dañina;
- disminución de confianza/utilidad.

## 26. Responsive y dispositivos

Probar mínimo:

- Android pequeño: 360 × 640 dp.
- Android medio: 360/384 × 800 dp.
- Android grande: 412 × 915 dp.
- iPhone SE equivalente.
- iPhone estándar.
- iPhone grande.
- Font scale 1.0, 1.3, 1.5 y 2.0.
- Navegación Android por gestos.
- Navegación Android de tres botones.
- Teclado abierto.
- Orientación admitida.

Aunque tablet esté deshabilitada, el layout no debe depender de un ancho fijo a nivel de módulo. Usar `useWindowDimensions` y límites máximos de contenido.

## 27. Performance percibida

- Interacción visual en menos de 100 ms.
- Skeleton en operaciones >300 ms.
- Indicador contextual en IA.
- No usar mensajes falsos de progreso.
- Poder cancelar análisis largos.
- Preservar foto/formulario ante error recuperable.
- Imágenes comprimidas sin degradar revisión.
- Listas virtualizadas.
- Evitar recalcular toda la pantalla por temporizadores.

## 28. QA de usabilidad

### 28.1 Prueba de cinco segundos

Después de cinco segundos, al menos 80% debe responder:

- qué pantalla es;
- cuál es la acción principal;
- cuál es su estado de hoy.

### 28.2 Tareas

Objetivo de éxito sin asistencia: mínimo 90%.

1. Iniciar entrenamiento de hoy.
2. Cambiar a versión de 20 minutos.
3. Registrar una comida manualmente.
4. Corregir una estimación de macros.
5. Seleccionar el ejercicio de hoy en Coach.
6. Preparar Coach en vivo correctamente.
7. Ver y borrar memoria del coach.
8. Registrar segundo peso.
9. Entender por qué aún no hay tendencia.
10. Desactivar notificaciones.
11. Exportar datos.
12. Eliminar cuenta.

### 28.3 Preguntas de comprensión

- ¿Los macros son exactos o estimados?
- ¿La foto se guarda?
- ¿Qué significa la racha?
- ¿Un día de descanso rompe la racha?
- ¿Qué recuerda el coach?
- ¿Cómo se elimina?
- ¿Qué ocurre si no hay conexión?
- ¿Premium se renueva automáticamente?

## 29. Priorización de implementación

### P0 — Antes de cualquier release visual

- Corregir contraste global.
- Corregir safe area/barra inferior.
- Diferenciar acción central de pestaña activa.
- Quitar copy de culpa y promesas absolutas.
- No mostrar “estancado” sin datos.
- Resolver conflicto objetivo/meta.
- Reordenar Home alrededor de siguiente acción.
- Rediseñar misiones que premian escaneo/registro compulsivo.
- Preseleccionar ejercicio contextual correcto.
- Añadir preflight visual en Coach en vivo.
- Añadir disclosures de privacidad antes de cámara/chat/fotos.
- Implementar estados loading/empty/error/offline sin ceros falsos.

### P1 — Antes del lanzamiento público

- Sustituir emojis funcionales.
- Renombrar y reorganizar Coach.
- Rediseñar rachas y descansos.
- Sesión corta/adaptación por molestias.
- Preferencias de notificación.
- Entrada manual y edición de comida.
- Centro de privacidad.
- Memoria del coach visible/editable.
- Accesibilidad 200% + TalkBack/VoiceOver.
- Layout responsive y listas virtualizadas.
- Analytics y funnels con allowlist.

### P2 — Optimización posterior

- Personalización del Home según momento del día.
- Recomendaciones contextuales por adherencia.
- Búsqueda avanzada de ejercicios.
- Historial de correcciones de técnica.
- Insights semanales explicables.
- Experimentos A/B con guardrails.
- Optimización tablet si entra en roadmap.

## 30. Checklist de entrega para pull request

Cada PR de pantalla debe incluir:

- captura Android pequeña;
- captura Android grande;
- captura iOS;
- captura con font scale 200%;
- video corto de interacción;
- estados loading, empty, error y offline;
- prueba TalkBack/VoiceOver;
- contraste verificado;
- eventos de analítica documentados;
- ninguna propiedad sensible;
- copy revisado;
- test de componente/lógica relevante;
- confirmación de safe areas;
- confirmación de teclado;
- confirmación de modo reduce motion;
- criterio de aceptación vinculado a este documento.

## 31. Criterio final de producto

GymUp estará bien diseñado cuando una persona pueda abrirla y sentir:

1. **Claridad:** sé qué hacer ahora.
2. **Capacidad:** puedo hacerlo completo o adaptarlo.
3. **Seguridad:** la app conoce sus límites y respeta mis datos.
4. **Progreso:** veo cambios reales, no solo puntos.
5. **Autonomía:** puedo descansar, pausar y elegir sin castigo.
6. **Confianza:** las estimaciones se presentan como estimaciones.
7. **Continuidad:** un día difícil no destruye mi avance.

La app no debe buscar que la persona permanezca más tiempo dentro de ella. Debe buscar que tome mejores decisiones fuera de ella y vuelva porque el producto le funciona.

---

## Apéndice A — Trazabilidad de las 16 imágenes

### Imagen 1

- Conservar identidad y objetivo.
- Reducir hero.
- Clarificar Mane/Maria Helena.
- Aumentar contraste.
- Corregir safe area inferior.

### Imagen 2

- “Guardar progreso” se vuelve prioridad.
- Acciones habilitadas no parecen disabled.
- Logout neutral.
- Añadir centro de privacidad y legales.

### Imagen 3

- Macros como estimación/rango.
- Unidades legibles.
- Explicación de cálculo.
- Mejor contraste en acciones.

### Imagen 4

- Reducir ceros.
- Eliminar `↑0%`.
- Entrenamiento antes que estadísticas.
- Cold start específico.

### Imagen 5

- Conservar CTA.
- Coach más corto y responsable.
- Hacer legibles accesos rápidos y biblioteca.

### Imagen 6

- Usar minutos.
- Sesión X de N, no día 1 de 7.
- Añadir versión corta y adaptación.

### Imagen 7

- No declarar estancamiento.
- Resolver meta contradictoria.
- Arreglar copy truncado.
- Estado vacío de peso neutral.

### Imagen 8

- Reducir scoreboard de ceros.
- Rediseñar misiones.
- Deshabilitar compra sin XP.
- Explicar racha y días de descanso.

### Imagen 9

- Funciones primero.
- Cupo neutral.
- Toda la tarjeta tocable.
- Mejorar contraste.

### Imagen 10

- “No registrado”, no “0 consumido”.
- Añadir registro manual.
- Consejo más útil y compacto.

### Imagen 11

- Renombrar Coach.
- Preselección contextual.
- Chips sin truncar.
- Borde verde solo para selección.

### Imagen 12

- Quitar promesa de 30 días.
- Quitar perfección/fallo/social proof.
- Logros legibles.
- Privacidad de fotos visible.

### Imagen 13

- Tres instrucciones principales.
- Guía visual en cámara.
- Copy probabilístico.
- No pedir pose difícil con carga.

### Imagen 14

- Preview y preflight antes de CTA.
- Audio con label.
- Cues visuales/haptic.
- Pausa, detener y dolor.

### Imagen 15

- Eliminar espacio vacío.
- Meta inequívoca.
- Memoria gestionable.
- Cupo secundario.
- Disclaimer legible.

### Imagen 16

- Iconografía profesional.
- Buscar/filtrar.
- Hoy/recientes primero.
- Corregir idiomas y safe area.

## Apéndice B — Decisiones que no deben revertirse sin investigación

- No convertir el verde en un color omnipresente para todo estado.
- No volver a textos `#555555` sobre fondo casi negro.
- No reintroducir mensajes de vergüenza o competencia social.
- No convertir escaneos corporales en misión de XP.
- No mostrar tendencia con una sola medición.
- No permitir que la cámara central parezca la pestaña activa en todas las rutas.
- No esconder privacidad únicamente en términos legales.
- No usar engagement bruto como sustituto de progreso saludable.
