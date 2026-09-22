-- Fix RLS on agency_members
-- The original schema had no SELECT policy and a recursive ALL policy.
-- This migration applies the correct policies.

-- 1. Drop old / potentially broken policies (ignore errors if they don't exist)
do $$ begin
  drop policy if exists "members can see their agency members" on agency_members;
  drop policy if exists "owners can manage members" on agency_members;
  drop policy if exists "owners can insert members" on agency_members;
  drop policy if exists "owners can update members" on agency_members;
  drop policy if exists "owners can delete members" on agency_members;
  drop policy if exists "agency_members_select" on agency_members;
  drop policy if exists "agency_members_insert" on agency_members;
  drop policy if exists "agency_members_update" on agency_members;
  drop policy if exists "agency_members_delete" on agency_members;
exception when others then null;
end $$;

-- 2. SECURITY DEFINER helper — runs as postgres, bypasses RLS (safe for policies)
create or replace function is_agency_owner(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agencies
    where id = p_agency_id and owner_id = auth.uid()
  );
$$;

-- 3. SELECT: direct check — no function, no recursion
create policy "members can see their agency members" on agency_members
  for select using ( user_id = auth.uid() );

-- 4. Write policies via SECURITY DEFINER function
create policy "owners can insert members" on agency_members
  for insert with check ( is_agency_owner(agency_id) );

create policy "owners can update members" on agency_members
  for update using ( is_agency_owner(agency_id) );

create policy "owners can delete members" on agency_members
  for delete using ( is_agency_owner(agency_id) );

-- 5. Grant missing permissions to authenticated role
grant select, insert, update, delete on public.agency_members to authenticated;
