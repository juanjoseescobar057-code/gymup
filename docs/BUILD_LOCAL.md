# Compilar el AAB en local

Sin EAS, sin cuota, sin cola. Una vez configurado, cada build son unos minutos
en tu máquina.

Esto NO reemplaza a EAS del todo. EAS también guardaba la keystore, llevaba el
contador de `versionCode` y alojaba el archivo. Al compilar en local esas tres
cosas pasan a ser tuyas, y están explicadas abajo.

---

## Una sola vez

### 1. SDK de Android

Instala [Android Studio](https://developer.android.com/studio). En el asistente
marca **Android SDK**, **SDK Platform-Tools** y **Android SDK Build-Tools**.
Ocupa unos 10 GB.

Después, comprueba que las variables existen (PowerShell):

```powershell
$env:ANDROID_HOME
```

Si sale vacío, añádela de forma permanente:

```powershell
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```

Cierra y vuelve a abrir la terminal para que la tome.

Java ya está: Zulu 21, que sirve para React Native 0.81.

### 2. La keystore

**Este paso no se puede saltar.** El AAB tiene que ir firmado con la MISMA
clave que usaba EAS, o Google Play rechaza la subida con "el certificado no
coincide". No hay forma de recuperarlo después.

```bash
npx eas-cli credentials
```

Elige **Android → production → Keystore → Download**. Guarda el archivo
`.jks` **fuera del repositorio** y apunta las tres contraseñas que te muestra.

### 3. Configurar la firma fuera del repo

Las credenciales van en `~/.gradle/gradle.properties`, NO en el proyecto: así
`expo prebuild --clean` no las borra y nunca acaban en un commit.

En Windows el archivo es `C:\Users\<tu-usuario>\.gradle\gradle.properties`:

```properties
GYMUP_UPLOAD_STORE_FILE=C:\\ruta\\donde\\guardaste\\gymup.jks
GYMUP_UPLOAD_STORE_PASSWORD=...
GYMUP_UPLOAD_KEY_ALIAS=...
GYMUP_UPLOAD_KEY_PASSWORD=...
```

---

## Cada vez que compiles

### 1. Sube el versionCode

En `app.json`, dentro de `android`. **Google quema el número en cuanto subes el
archivo, aunque después descartes el borrador**, así que nunca se puede
reutilizar. Ya están usados el 19 y el 20 en Play, y el 21 quedó reservado en
EAS.

### 2. Genera el proyecto nativo

```bash
npx expo prebuild --platform android --clean
```

`--clean` borra y regenera `android/`. Es lo correcto: esa carpeta está en
`.gitignore` y se reconstruye desde `app.json` y los plugins, así que nunca
guarda cambios a mano. Por eso las credenciales viven fuera.

### 3. Compila

```bash
cd android && ./gradlew bundleRelease
```

La primera vez tarda bastante —compila cámara, TensorFlow y el resto de
módulos nativos— y las siguientes van mucho más rápido por la caché de Gradle.

El AAB queda en:

```
android/app/build/outputs/bundle/release/app-release.aab
```

### 4. Antes de subirlo

```bash
npm run verify
```

Secretos, tipos y los tests. Lo mismo que corría el CI antes de cada build.

---

## Si algo falla

**"SDK location not found"** → falta `ANDROID_HOME`, o la terminal se abrió
antes de definirla.

**"keystore was tampered with, or password was incorrect"** → alguna de las
contraseñas de `gradle.properties` no coincide con lo que dio `eas credentials`.

**Play dice "el certificado de subida no coincide"** → firmaste con una
keystore distinta a la de EAS. Vuelve al paso 2; no se arregla desde Play.

**Gradle se queda sin memoria** → sube el límite en
`android/gradle.properties`: `org.gradle.jvmargs=-Xmx4096m`. Ojo, ese archivo
lo regenera el prebuild, así que hay que repetirlo o moverlo al plugin.
