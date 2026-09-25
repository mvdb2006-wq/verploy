-- De worker (service role) leest update_intel bij de geplande updates. In productie krijgt de service role
-- geen standaardrechten op nieuwe tabellen; lokaal wel (daardoor miste de test dit).
grant select on public.update_intel to service_role;
