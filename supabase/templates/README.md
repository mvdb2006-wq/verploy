# Auth-mails (Supabase)

De mails van Supabase Auth in de Verploy-stijl (afzender `Verploy <noreply@verploy.com>` via custom SMTP bij Resend).
Productie: Supabase → Authentication → Emails → Templates; per template het onderwerp uit `subjects.json` en de body
uit `<type>.html`. Supabase-variabelen (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, `{{ .NewEmail }}`) blijven staan.
Supabase heeft geen reply-to voor auth-mails; daarom staat team@verploy.com in de tekst.
