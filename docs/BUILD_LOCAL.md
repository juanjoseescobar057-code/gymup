# Compilar el AAB en local

Sin EAS, sin cuota, sin cola. Una vez configurado, cada build son unos minutos
en tu máquina.

Esto NO reemplaza a EAS del todo. EAS también guardaba la keystore, llevaba el
contador de `versionCode`, alojaba el archivo y aportaba unas cuantas cosas del
entorno que aquí no existen. Todas están cubiertas abajo; ninguna se puede
saltar.

---

## Una sola vez

### 1. SDK de Android

Instala [Android Studio](https://developer.android.com/studio). Ocupa unos
10 GB, y el asistente por defecto NO deja el proyecto compilable: faltan el NDK
y CMake.

> ⚠️ **En Windows, el SDK NO puede vivir en una ruta con espacios.** El
> asistente propone `C:\Users\<tu-usuario>\AppData\Local\Android\Sdk`, que
> lleva espacios si tu usuario los tiene. **Instálalo en `C:\Android\Sdk`.**
>
> El motivo, que costó una compilación de 32 minutos descubrir: cuando la ruta
> lleva espacios, CMake invoca al compilador por su nombre corto 8.3, y
> `clang++.exe` se convierte en `CLANG_~1.EXE`. Clang decide si actúa como
> compilador de C o de C++ **por el nombre con el que lo llaman**, así que al
> perder los `++` enlaza en modo C y deja fuera la biblioteca estándar de C++.
> El build muere al final con cientos de `undefined symbol: operator new`,
> `__cxa_throw`, `std::__ndk1::...` — un error que no menciona la ruta por
> ningún lado y que parece un problema de la librería que estabas compilando.
>
> En EAS no pasaba porque es Linux y no hay nombres 8.3.
>
> `npm run build:android` lo comprueba antes de empezar.

Abre **More Actions → SDK Manager** e instala, marcando antes
**Show Package Details** para poder elegir versiones exactas:

| Pestaña | Componente |
|---|---|
| SDK Platforms | **Android SDK Platform 36** |
| SDK Tools | **Android SDK Build-Tools 36.0.0** |
| SDK Tools | **Android SDK Platform-Tools** |
| SDK Tools | **Android SDK Command-line Tools (latest)** |
| SDK Tools | **NDK (Side by side) 27.1.12297006** |
| SDK Tools | **CMake** |

Los números no son arbitrarios ni negociables: salen de
`node_modules/react-native/gradle/libs.versions.toml`, que es de donde los lee
Gradle. Tener la plataforma 37 no vale — son paquetes distintos, no una versión
más nueva que sirva igual.

El NDK y CMake tampoco son opcionales: cinco módulos compilan C++
(`vision-camera`, `fast-tflite`, `worklets-core`, `nitro-modules` y
`vision-camera-resize-plugin`).

`npm run build:android` comprueba todo esto antes de empezar y lee las
versiones de ese mismo catálogo, así que al subir de versión de Expo la
comprobación se actualiza sola.

Después, comprueba que la variable existe (PowerShell):

```powershell
$env:ANDROID_HOME
```

Si sale vacío, defínela de forma permanente:

```powershell
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```

Cierra y vuelve a abrir la terminal para que la tome.

Java ya está: Zulu 21, que sirve para React Native 0.81.

### 2. La keystore

El AAB tiene que ir firmado con la MISMA clave que usaba EAS, o Play rechaza la
subida por certificado incorrecto. **Esto no se puede arreglar después**: esa
clave es la identidad de la app publicada.

```bash
npx eas-cli credentials -p android
```

`production` → `Keystore: Manage everything needed to build your project` →
**`Download existing keystore`**. Cuidado con `Set up a new keystore`, que
genera una clave distinta y te deja sin poder actualizar la app.

El archivo cae en la carpeta desde la que corriste el comando, o sea dentro del
repo. **Muévelo fuera.** Está en `.gitignore`, así que no se sube a git, pero
un `git clean` o volver a clonar se lo llevaría por delante. Guarda además una
copia en otro sitio.

### 3. Configurar la firma

Las credenciales van en `C:\Users\<tu-usuario>\.gradle\gradle.properties`, NO
en el proyecto: `expo prebuild --clean` borra y regenera `android/` entera en
cada build, así que cualquier cosa que dejes ahí dentro desaparece.

Ese archivo probablemente no existe todavía; créalo:

```properties
GYMUP_UPLOAD_STORE_FILE=C:/Users/tu-usuario/claves/gymup.jks
GYMUP_UPLOAD_STORE_PASSWORD=...
GYMUP_UPLOAD_KEY_ALIAS=...
GYMUP_UPLOAD_KEY_PASSWORD=...
```

Usa **barras normales** (`/`) en la ruta. Gradle lee estos archivos como
properties de Java, donde `\` es un carácter de escape y una ruta de Windows
con barras invertidas se interpreta mal.

Quien lee esas cuatro propiedades es
[`plugins/withFirmaRelease.js`](../plugins/withFirmaRelease.js). Sin ese plugin
la plantilla de Expo firma el release con la keystore de **depuración**, y el
AAB resultante se instala y arranca sin quejarse: el fallo solo aparece al
subirlo a Play. Por eso el plugin corta el build si las propiedades no están.

---

## Cada vez que compiles

### 1. Sube el versionCode

En `app.json`, dentro de `android`. **Google quema el número en cuanto subes el
archivo, aunque después descartes el borrador**, así que nunca se puede
reutilizar. Usados: 19 y 20 en Play, 21 reservado en EAS.

### 2. Compila

```bash
npm run build:android
```

Un solo comando. Hace, en este orden:

1. Comprueba que la keystore está configurada y que el `.jks` sigue donde dice
   — antes de compilar, no después.
2. `npm run verify`: secretos, tipos y tests.
3. El informe de revisiones externas pendientes (lo que en EAS disparaba el
   hook `eas-build-pre-install`, que en local no ejecuta nadie).
4. `expo prebuild --platform android --clean`.
5. `gradlew bundleRelease` con `SENTRY_DISABLE_AUTO_UPLOAD=true`.

Ese último detalle importa: era una variable de entorno del proyecto en EAS.
Sin ella el plugin de Sentry intenta subir los source maps y no encuentra ni
organización, ni proyecto, ni token. Hoy tampoco los subíamos en EAS; cuando se
configure el token de Sentry, se quita de aquí.

La primera compilación tarda bastante —cámara, TensorFlow y el resto de módulos
nativos desde cero— y las siguientes van mucho más rápido por la caché de
Gradle.

El AAB queda en:

```
android/app/build/outputs/bundle/release/app-release.aab
```

---

## Lo que NO cambia respecto a EAS

Comprobado, para que nadie lo vuelva a investigar:

- **Variables de entorno.** Las seis `EXPO_PUBLIC_*` del `.env` local son
  idénticas a las del entorno `production` de EAS. `expo prebuild` y
  `expo export:embed` cargan `.env` solos, así que quedan incrustadas en el
  bundle igual que antes. Si algún día cambias una en EAS, cámbiala también
  aquí, o el AAB local apuntará a otro sitio sin avisar.

  ⚠️ **Con un matiz que importa: `.env.local` gana sobre `.env`.** Expo carga
  los dos y el `.local` tiene prioridad. Como está en `.gitignore`, ningún
  build de EAS lo vio nunca; en local sí manda. Hoy este repo tiene un
  `.env.local` con cuatro claves idénticas a las de `.env`, así que no cambia
  nada — pero si un día se rota la anon key y solo se actualiza `.env` (el
  archivo versionado, el que se revisa en el PR), el AAB local saldría con el
  valor viejo y sin ningún aviso. Por eso `npm run build:android` compara los
  dos archivos y aborta si alguna clave compartida difiere.
- **`expo-updates` no está instalado**, así que no hay OTA ni `runtimeVersion`
  de por medio.
- **Firmado de Play.** Google conserva su propia clave de firma; la keystore de
  arriba es solo la de *subida*.

## Si algo falla

**"SDK location not found"** → falta `ANDROID_HOME`, o la terminal se abrió
antes de definirla.

**"Falta GYMUP_UPLOAD_STORE_FILE"** → no existe
`~/.gradle/gradle.properties`, o le falta alguna de las cuatro propiedades.

**"keystore was tampered with, or password was incorrect"** → alguna contraseña
no coincide con lo que dio `eas credentials`.

**Play dice "el certificado de subida no coincide"** → firmaste con una
keystore distinta a la de EAS. Vuelve al paso 2; no se arregla desde Play.

**Gradle se queda sin memoria** → sube el límite en
`android/gradle.properties`: `org.gradle.jvmargs=-Xmx4096m`. Ojo, ese archivo
lo regenera el prebuild; si hace falta de forma permanente, va en un config
plugin, no a mano.

**El plugin de firma lanza "la plantilla de Expo cambió"** → una versión nueva
del SDK cambió `android/app/build.gradle`. Está hecho a propósito: es
preferible parar a generar en silencio un AAB mal firmado. Hay que actualizar
las anclas de `plugins/withFirmaRelease.js` y su test.
