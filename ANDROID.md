# Caddy Stack for Android

Caddy Stack has two build targets that share the same React screens and data model:

- `npm run build` is the existing Next.js application deployed by Vercel. Nothing about the Vercel deployment path changes.
- `npm run native:build` creates a local web bundle in `dist-native`, and Capacitor packages that bundle in the checked-in `android` project.

The installed app does not load the live website in a WebView. Its interface is bundled with the app, while requests to `/api/*` are sent to `https://caddy-stack.vercel.app`. Supabase and AI credentials therefore remain in Vercel server functions and are never packaged in Android.

## One-time workstation setup

Install:

1. Node.js 22 or later.
2. Android Studio 2025.2.1 or later, including Android SDK Platform 36 and its build tools.
3. An Android 7+ device or emulator. Capacitor's minimum supported Android API is 24.

Android Studio's bundled JDK is sufficient. Set `ANDROID_HOME` to the installed SDK if the command-line tools cannot locate it.

## Develop and test

```bash
npm install
npm run android:sync
npm run android:open
```

`android:sync` always rebuilds the native web bundle before copying it into the Android project. Use `npm run android:run` to choose a connected emulator/device from the terminal instead.

Voice recording uses the existing browser `MediaRecorder` code inside Capacitor and declares Android's runtime microphone permission. Scorecard capture uses Capacitor's native Camera/Photo Picker. The app stores its local offline mirror in WebView storage and syncs through the same Vercel endpoints as the website.

## Future Google Play bundle

The project is ready for a release build, but it intentionally has no signing key checked in. Before the first Play Store release:

1. Confirm the permanent application ID in `capacitor.config.ts` and `android/app/build.gradle`. It is currently `com.zogby.caddystack`; changing it after publishing creates a different Play Store app.
2. Replace the generated launcher and splash artwork in Android Studio.
3. Create and securely back up a release keystore. Never commit it or its passwords.
4. Increment `versionCode` and `versionName` in `android/app/build.gradle` for each release.
5. Complete Play Console privacy/data-safety declarations for microphone, photos, golfer profiles, and round data.

After configuring signing in Android Studio, use **Build → Generate Signed Bundle / APK → Android App Bundle**. Capacitor can also build a signed AAB from the command line:

```bash
npm run android:sync
npx cap build android --androidreleasetype AAB \
  --keystorepath <path-to-keystore> \
  --keystorepass <keystore-password> \
  --keystorealias <key-alias> \
  --keystorealiaspass <key-password>
```

The convenience command `npm run android:bundle` creates an AAB after sync once an Android SDK and signing setup are available. Keystore files (`*.jks`, `*.keystore`) and Android's machine-local files are ignored by Git.

## Important configuration seams

- `capacitor.config.ts`: native identity, bundled web directory, HTTP bridge, and status bar.
- `vite.native.config.mts`: native-only build and the small Next.js navigation compatibility aliases.
- `native/`: native entry point, hash router, safe-area styling, and navigation shims.
- `lib/api-url.ts`: the Vercel API origin used only on native platforms.
- `android/app/src/main/AndroidManifest.xml`: Android permissions and application metadata.

If the production Vercel domain changes, update `CADDY_STACK_API_ORIGIN` in `lib/api-url.ts`, then run `npm run android:sync`.
