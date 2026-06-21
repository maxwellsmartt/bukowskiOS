# Supabase Storage

Los bytes privados de documentos viven en `workspace-documents`. La metadata
canónica cross-machine vive en `public.workspace_files`.

Formato obligatorio de object key:

`{workspace_id}/{domain}/{entity_id}/{file_id}/{original_name}`

Dominios soportados:

- `assets`
- `incidents`
- `finance`
- `crew`
- `invoices` conserva su flujo compatible de Invoice Inbox

Las políticas de Storage y de `workspace_files` validan permisos del usuario
por workspace y dominio. Las rutas locales (`storage_path`, `file_url`) nunca
son parte del contrato remoto.
