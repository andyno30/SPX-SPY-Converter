-- REQUIRED before deploying selectable Pro prices. Local, unapplied migration.
-- Inspection on 2026-09-14 found profiles_update_own allows users to change their
-- subscription flag. Preserve own-row reads/other updates and all Stripe writes.
begin;

create or replace function public.protect_profile_billing_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.is_subscribed is distinct from old.is_subscribed
       or new.subscription_id is distinct from old.subscription_id
       or new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'Billing fields can only be changed by the server'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_billing_fields on public.profiles;
create trigger protect_profile_billing_fields
before update on public.profiles
for each row execute function public.protect_profile_billing_fields();

commit;
