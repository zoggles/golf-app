# Google account setup

Caddy Stack uses Google OAuth through Supabase Auth. The browser and Android app receive a short-lived user session; database service credentials remain server-only. Every app API validates the access token with Supabase and derives the golfer owner from the verified Auth user.

## 1. Apply the database migration

Run `supabase/migrations/20260909_google_account_ownership.sql` in the Supabase SQL editor for the `golf-app` project.

To attach existing rounds to an existing golfer before their first login, set that row's lowercase Google email:

```sql
select id, name from public.golfers order by name;
update public.golfers
set login_email = 'person@gmail.com'
where id = '<their-existing-golfer-id>';
```

## 2. Configure Google OAuth

In Google Cloud Console, create a Web OAuth 2.0 client for Caddy Stack. Add this authorized redirect URI:

```text
https://jjalejuswitoysnxgvtc.supabase.co/auth/v1/callback
```

Complete the OAuth consent/branding setup, then copy the Google client ID and client secret into Supabase Dashboard → Authentication → Sign In / Providers → Google and enable the provider.

## 3. Allow application callbacks

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://caddy-stack.vercel.app`
- Redirect URLs:
  - `https://caddy-stack.vercel.app/play`
  - `http://localhost:3000/play`
  - `com.zogby.caddystack://auth/callback`

The custom scheme is handled by the checked-in Android manifest and Capacitor App listener.

## 4. Environment variables

Set these for Development, Preview, and Production in Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL=https://jjalejuswitoysnxgvtc.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase server secret/service-role key>
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` remains supported for an older Supabase key setup. A publishable/anon key is intentionally safe to ship in web and Android clients; a service-role key is not.

## 5. Name and PIN sign-in

Anyone without a Google account can sign in with a name and a 6-digit PIN. No
email address is collected or shown. Each pair is backed by an ordinary Supabase
Auth password account whose address is derived from the name on the reserved
`pin.caddystack.invalid` domain, so sessions, refresh, and every API check behave
exactly as they do for Google.

Names are matched without case or punctuation, so `Nate Zogby` and `nate zogby`
are the same account. The first person to use a name claims it; after that the
PIN must match. `POST /api/pin-auth` provisions the account with the secret key
and is only reached once signing in has already failed, so it never reveals
whether a name exists.

A 6-digit PIN is the shortest Supabase Auth accepts by default (its minimum
password length). Brute force is bounded only by Supabase's own auth rate limits,
which is a deliberate trade for a small private roster.

## 6. Verification before release

1. Sign in on the Vercel site with the mapped Google account and confirm old rounds appear.
2. Sign out, use a different Google account, and confirm no first account rounds appear.
3. Record a test round on web and confirm it appears after signing into Android.
4. Delete the test account from the account menu and confirm its golfer and games are gone.
5. Use `https://caddy-stack.vercel.app/delete-account` for Google Play's external account-deletion URL.

Google Play also requires accurate Data safety answers and a privacy policy. Authentication collects the Google account ID, email address, and display name; the app stores the golfer's course and round data.
