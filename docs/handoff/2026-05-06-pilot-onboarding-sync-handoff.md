# Handoff — Pilot Onboarding, Sync, Team & Packaging

Fecha: 2026-05-06  
Branch: `codex/project-creation-wizard-v1`  
Último commit/push: `f27247f chore: harden pilot onboarding and sync`  
Roadmap vivo: `docs/roadmap/auth-workspaces-notifications-overhaul.md`

## Estado Ejecutivo

Estamos en una fase de **Pilot Readiness Hardening**: el objetivo inmediato es que Carlos e Iván puedan usar bukowskiOS con login real, workspace compartido, sync operativo y una experiencia de primer uso razonablemente profesional.

El branch quedó limpio, commiteado y pusheado a GitHub:

- Branch remoto: `origin/codex/project-creation-wizard-v1`
- Commit: `f27247f`
- Working tree al cierre: limpio

## Qué Se Implementó En Este Corte

### Onboarding / Login / First Login

- Las rutas de auth/workspace setup ya no muestran sidebar, subnav, top context ni FAB:
  - `/login`
  - `/login/reset-password`
  - `/workspaces/select`
  - `/workspaces/create`
- Login recibió polish visual:
  - fondo más oscuro/elegante,
  - logo real de bukowskiOS,
  - panel ambiental sutil,
  - copy más orientado a operación.
- `ResetPasswordScreen` soporta modo first-login:
  - título `Create your password`,
  - copy específico para primer login,
  - navegación a workspace picker después de crear password.
- `SessionProvider.handleAuthDeepLink` reconoce:
  - `flow=first-login`,
  - `flow=invite`,
  - `type=recovery`,
  - y permite que magic link/invite lleven al usuario a crear password.

### Invites / Usuarios Existentes

- `send-invite` ahora maneja usuarios que ya existen en Supabase Auth:
  - busca por email en Auth,
  - actualiza/crea `user_profiles`,
  - upsertea membership en `workspace_memberships`,
  - si el usuario ya existía, lo marca `active`,
  - envía magic link con `flow=first-login`.
- El edge function quedó desplegado:
  - `send-invite` version `9`,
  - `verify_jwt=false`,
  - la función valida el bearer internamente contra `/auth/v1/user`.
- `InviteMemberDialog` y `inviteService` muestran mejor estado para:
  - invitación nueva,
  - usuario existente,
  - acceso actualizado,
  - warning si Supabase no pudo enviar email.

### Team / Roles Remotos

- `WorkspaceSettingsPage` ahora prefiere usuarios/memberships remotos cuando Supabase está activo.
- Esto corrige el bug de mandar IDs locales tipo `user-carlos...` a columnas UUID remotas.
- Se agregaron migraciones Supabase:
  - `20260506133000_user_profiles_email_and_member_read.sql`
  - `20260506134500_seed_operational_workspace_roles.sql`
- `Metadata Cine2` ya tiene roles remotos operativos:
  - Admin,
  - Crew,
  - Supervisor,
  - Finance Viewer,
  - Maintenance.
- `admin-workspace-bootstrap` fue actualizado para que workspaces nuevos nazcan con esos roles y permisos base.

### Carlos / Workspace

- Carlos pudo entrar por magic link.
- El problema era que existía en Supabase Auth pero no tenía membership en el workspace.
- Se corrigió creando membership activa Admin para `carlos@metadatacine.com` en `Metadata Cine2`.
- Próximo smoke pendiente: en la app actualizada, Carlos debe ver el workspace sin pasar por Create Workspace.

### Sync Operacional

- Se endureció pull/apply de snapshots operativos:
  - Projects,
  - Packing Slips,
  - Incidents,
  - RMAs.
- El cursor ya no debe avanzar si el apply local falla de forma recuperable.
- El pull usa lookback de 14 días para recuperar máquinas que habían adelantado cursor con errores.
- Projects tolera referencias opcionales de catálogo aún no descargadas.
- Packing Slips reintenta si falta project/unit y hace upsert de items por `(packing_slip_id, asset_id)`.
- Se agregaron/actualizaron tests de `operationalSnapshotService`.

### Packaging / Startup / Window

- Se endureció apertura de ventana en builds instalados:
  - descarta bounds persistidos fuera de pantalla,
  - muestra/focus aunque `ready-to-show` no dispare,
  - `activate` y `second-instance` restauran la ventana.
- La pantalla `Starting bukowskiOS` aparece antes de inicializar DB.
- Startup ahora muestra logo/barra de carga y registra pasos.
- Se corrigió un bloqueo donde una migración runtime del project wizard fallaba con FK y dejaba la app pegada en startup.
- `projectCreationWizardFoundationBootstrap` ahora evita sembrar datos si falta el workspace local esperado.

### Icono / Logo Desktop

- Se regeneró `apps/desktop/build/icon.icns` desde el logo desktop nuevo.
- Se actualizó `icon.iconset`.
- Se agregó script reproducible:
  - `apps/desktop/build/generate-icns.cjs`
- Se actualizaron assets:
  - `bukowskiOS-desktop-logo.png`
  - `bukowskiOS-desktop-logo@2x.png`
  - `bukowskiOS-desktop-logo@3x.png`

### AI Agent

- El actor local técnico `user-ops` se mantiene como ID compatible.
- Su identidad visible local ahora es:
  - Nombre: `AI Agent`
  - Email: `ai-agent@bukowskios.local`
- Esto evita romper auditoría/tests existentes.
- No se creó todavía como usuario Auth remoto.

## Supabase Estado

Proyecto:

- Ref: `jmxkejpdklrrzhvzjlqm`
- URL: `https://jmxkejpdklrrzhvzjlqm.supabase.co`

Edge Functions relevantes:

- `admin-workspace-bootstrap`
  - actualizado para roles operativos base.
- `send-invite`
  - version `9`,
  - `verify_jwt=false`,
  - validación bearer interna.

Migraciones nuevas en repo:

- `supabase/migrations/20260506133000_user_profiles_email_and_member_read.sql`
- `supabase/migrations/20260506134500_seed_operational_workspace_roles.sql`

Nota:

- Estas migraciones ya fueron aplicadas durante la sesión de oficina.
- Si en casa el entorno local no refleja esto, no las dupliques en Supabase sin revisar historial primero.

## Verificaciones Corridas

Últimas verificaciones exitosas:

- `corepack pnpm --filter @bukowski/desktop typecheck`
- `corepack pnpm --filter @bukowski/desktop build`

También se habían corrido antes en el mismo corte:

- tests focalizados de operational snapshots,
- build/package macOS,
- deploy de edge functions.

## Qué Falta Validar En Casa

### 1. Smoke de Carlos / Usuario Real

Con la app actualizada:

- Carlos abre app.
- Login por magic link o password.
- Debe ver `Metadata Cine2` en Workspace Picker.
- Debe poder entrar sin crear workspace nuevo.

Si no ve el workspace:

- revisar `workspace_memberships` remoto,
- revisar si la app descargó memberships,
- revisar logs de `WorkspaceProvider`.

### 2. Invite De Usuario Nuevo

Probar con un email que no exista en Supabase Auth:

- Invite desde Team.
- Usuario recibe email.
- Abre deep link.
- Crea password.
- Ve workspace invitado.

### 3. Invite De Usuario Existente

Probar con un usuario ya existente:

- Invite/update access desde Team.
- Debe actualizar membership.
- Debe enviar magic link con `flow=first-login`.
- Si Supabase no envía email, la UI debe mostrar warning y no mentir.

### 4. Role Change / Suspend / Reactivate

En Team:

- Cambiar rol de un miembro remoto.
- Suspender miembro.
- Reactivar si aplica.

El bug esperado ya corregido:

- No deben aparecer errores de tipo `invalid input syntax for type uuid: "user-..."`.

### 5. Sync Multiusuario

Con dos usuarios en el mismo workspace:

- Usuario A crea/edita Project.
- Usuario A crea Packing Slip.
- Usuario A crea Incident.
- Usuario A crea RMA.
- Usuario B hace Pull/Refresh.
- Usuario B debe ver esos datos.

Si hay errores:

- revisar Settings → Sync Activity,
- revisar upload queue,
- revisar download coverage,
- revisar logs con `operational snapshot`.

### 6. Startup / App Instalada

En Mac externa:

- app abre ventana visible,
- no queda invisible en Dock,
- si sale `Starting bukowskiOS`, debe avanzar o mostrar error visible,
- no debe quedarse pegada silenciosamente.

## Deudas / Riesgos Abiertos

### Crítico — Smoke Multiusuario Pendiente

El código está endurecido, pero falta validación real con dos usuarios usando una build actualizada.

Mitigación:

- hacer smoke corto antes de entregar a Iván/Carlos como build “usable”.

### Crítico — AI Agent Remoto No Modelado

El `AI Agent` local existe, pero no como entidad remota segura.

Recomendación:

- crear un modelo `system_actors` por workspace,
- usarlo para auditoría de acciones de agentes,
- evitar crear un Auth user humano falso salvo que RLS lo requiera explícitamente.

### Medio — OAuth Google/GitHub Pendiente

El código ya tiene:

- botones Google/GitHub,
- `signInWithOAuth`,
- redirect `bukowskios://auth/callback`.

Falta en Supabase Dashboard:

- activar Google provider,
- activar GitHub provider,
- agregar Client ID/Secret de cada provider,
- validar redirect en app instalada.

### Medio — Settings Sigue Pesado

Sync Activity mejoró, pero Settings todavía tiene demasiada información técnica.

Recomendación:

- Overview simple para usuarios normales,
- Advanced colapsado,
- Data/Sync con lenguaje orientado a acción.

### Medio — MFA TOTP Placeholder

La pantalla existe, pero falta wiring real con Supabase MFA.

### Medio — Agents Aún Arrastran `LOCAL_FALLBACK_WORKSPACE_ID`

El runtime de agentes debe rediseñarse para workspace activo.

Esto debe venir después de:

- smoke de auth/workspace,
- sync multiusuario,
- modelo remoto de `AI Agent`.

## Próximo Slice Recomendado

### Slice recomendado: Pilot Onboarding Smoke + OAuth Prep

Objetivo:

Cerrar la experiencia de primer uso para usuarios reales antes de avanzar a más features.

Orden recomendado:

1. Probar build actualizada con Carlos:
   - login,
   - workspace visible,
   - Team actions.
2. Probar invite de usuario nuevo:
   - email,
   - first-login password,
   - workspace picker.
3. Probar sync multiusuario:
   - Project,
   - Packing Slip,
   - Incident,
   - RMA.
4. Activar Google/GitHub en Supabase Dashboard.
5. Diseñar mini-slice `system_actors` / `AI Agent` remoto.
6. Recién después, empaquetar build piloto para Iván/Carlos.

## Archivos Más Relevantes Del Corte

Auth/onboarding:

- `apps/desktop/src/app/shell/AppShell.tsx`
- `apps/desktop/src/app/providers/SessionProvider.tsx`
- `apps/desktop/src/features/auth/LoginScreen.tsx`
- `apps/desktop/src/features/auth/ResetPasswordScreen.tsx`
- `apps/desktop/src/shared/styles/global.css`

Team/invites:

- `apps/desktop/src/features/admin/WorkspaceSettingsPage.tsx`
- `apps/desktop/src/features/admin/InviteMemberDialog.tsx`
- `apps/desktop/src/features/admin/inviteService.ts`
- `supabase/functions/send-invite/index.ts`

Roles/bootstrap:

- `supabase/functions/admin-workspace-bootstrap/index.ts`
- `supabase/migrations/20260506133000_user_profiles_email_and_member_read.sql`
- `supabase/migrations/20260506134500_seed_operational_workspace_roles.sql`

Sync:

- `apps/desktop/electron/main/services/data/operationalSnapshotService.ts`
- `apps/desktop/src/shared/hooks/useOperationalSnapshotPull.ts`
- `apps/desktop/src/test/operational-snapshot-service.test.ts`
- `docs/foundation/sync-roadmap.md`

Startup/packaging:

- `apps/desktop/electron/main/app.ts`
- `apps/desktop/electron/main/windows/createMainWindow.ts`
- `apps/desktop/electron/main/windows/windowState.ts`
- `apps/desktop/electron/main/services/data/localDatabase.ts`
- `apps/desktop/electron/main/services/data/projectCreationWizardFoundationBootstrap.ts`
- `apps/desktop/build/generate-icns.cjs`
- `apps/desktop/electron-builder.config.cjs`

Roadmap:

- `docs/roadmap/auth-workspaces-notifications-overhaul.md`

## Prompt Sugerido Para Continuar En Casa

Estoy en `/Users/ernestooffice2/Dev/bukowskiOS`, branch `codex/project-creation-wizard-v1`. Lee primero `docs/handoff/2026-05-06-pilot-onboarding-sync-handoff.md` y `docs/roadmap/auth-workspaces-notifications-overhaul.md`. El último commit pusheado es `f27247f chore: harden pilot onboarding and sync`.

Quiero continuar con Pilot Readiness. Primero valida estado local, corre typecheck/build si hace falta, y ayúdame a probar onboarding real: invite de usuario nuevo, usuario existente, first-login password, workspace picker, role change/suspend y sync multiusuario para Projects/Packing/Incidents/RMAs. Mantén actualizado el roadmap vivo. No avances a Notifications ni Agents hasta cerrar el smoke multiusuario y decidir el modelo remoto seguro del `AI Agent`.
