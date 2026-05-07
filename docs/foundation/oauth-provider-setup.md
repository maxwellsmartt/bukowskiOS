# OAuth Provider Setup

Estado: Ready for dashboard configuration

Este documento cubre lo que falta para activar login con Google y GitHub en bukowskiOS. El cliente Electron ya llama `supabase.auth.signInWithOAuth` con `redirectTo: bukowskios://auth/callback`; lo pendiente son las credenciales de cada proveedor en sus dashboards y en Supabase Auth.

## Proyecto Supabase

- Project ref: `jmxkejpdklrrzhvzjlqm`
- Supabase URL: `https://jmxkejpdklrrzhvzjlqm.supabase.co`
- App deep link: `bukowskios://auth/callback`
- Dev app callback: `http://127.0.0.1:17654/auth/callback`
- Provider callback URL: `https://jmxkejpdklrrzhvzjlqm.supabase.co/auth/v1/callback`

## Google

1. En Google Cloud / Google Auth Platform, crear un OAuth Client ID tipo `Web application`.
2. En `Authorized redirect URIs`, agregar:

```text
https://jmxkejpdklrrzhvzjlqm.supabase.co/auth/v1/callback
```

3. En Supabase Dashboard -> Authentication -> Providers -> Google:
   - Enable Google.
   - Pegar `Client ID`.
   - Pegar `Client Secret`.
   - Guardar.

Scopes recomendados para v1:

```text
openid
email
profile
```

No agregar scopes sensibles todavía. Si más adelante conectamos Google Drive/Calendar, eso debe ser otro slice con consentimiento claro.

## GitHub

1. En GitHub Developer settings, crear una OAuth App.
2. En `Authorization callback URL`, agregar:

```text
https://jmxkejpdklrrzhvzjlqm.supabase.co/auth/v1/callback
```

3. En Supabase Dashboard -> Authentication -> Providers -> GitHub:
   - Enable GitHub.
   - Pegar `Client ID`.
   - Pegar `Client Secret`.
   - Guardar.

## Supabase URL Configuration

Confirmar que `bukowskios://auth/callback` esté permitido en Authentication -> URL Configuration -> Redirect URLs.

Para desarrollo local con `corepack pnpm dev`, confirmar también:

```text
http://127.0.0.1:17654/auth/callback
```

También mantener los dev origins usados por Electron/Vite mientras seguimos en piloto local.

## Smoke Test

1. Abrir la app instalada o `corepack pnpm dev`.
2. En login, usar `Continue with Google`.
3. Completar consentimiento.
4. Confirmar que macOS vuelve a abrir bukowskiOS por `bukowskios://auth/callback`.
5. Confirmar que se ve `Choose workspace` o el workspace activo.
6. Repetir con `Continue with GitHub`.

## Riesgos

- Crítico: nunca guardar `Client Secret` de Google/GitHub en `.env.local`, repo, renderer o Electron.
- Medio: si el redirect de Supabase provider está mal, el usuario completará login en el browser pero no volverá a la app.
- Medio: si falta `bukowskios://auth/callback` o `http://127.0.0.1:17654/auth/callback` en Supabase Redirect URLs, Supabase rechazará el flujo según se pruebe build instalada o dev local.
- Bajo: Google consent sin branding puede verse menos confiable; activar branding antes de invitar usuarios externos.
