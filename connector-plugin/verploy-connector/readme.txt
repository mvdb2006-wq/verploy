=== Verploy Connector ===
Contributors:      verploy
Tags:              maintenance, updates, monitoring, agency, staging
Requires at least: 5.8
Tested up to:      7.1
Requires PHP:      7.4
Stable tag:        2.5.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Connects your WordPress site to Verploy — automated update testing, server health monitoring, and white-label client reports for agencies.

== Description ==

**Verploy** helps WordPress agencies update client sites safely. Install this connector on each client site to get:

* **Tested updates** — Before a plugin, theme or core update goes live, Verploy copies the site to a private staging copy on the same server, applies the update there and runs browser tests (errors, broken files, missing page parts, visual comparison on desktop and mobile). If something breaks, nothing goes live.
* **Automatic rollback** — Updates that pass go live during a short maintenance window with a backup of files and database. If the check after going live fails, the site is restored automatically.
* **Failure diagnosis** — When a test fails, Verploy explains the likely cause and how to fix it.
* **Health monitoring** — WordPress, PHP and plugin versions, available updates, memory limit and free disk space.
* **One-click login to WP Admin** — Owners and admins of the agency can log in as a site administrator from Verploy, without a password. The site owner can turn this off under Settings → Verploy, where every login is logged.

This plugin is the secure bridge between your site and the Verploy dashboard at app.verploy.com. Every request in both directions is signed (HMAC-SHA256 with a per-site secret, timestamp and one-time nonce).

= Privacy =

The plugin sends site health data (WordPress, PHP and plugin/theme versions, memory limit, free disk space) to app.verploy.com. During a tested update the Verploy service loads pages of the site to test them. It also sends the user names and display names of the site's administrators (at most 20), so the agency can choose which administrator Verploy logs in as. No visitor data or content is sent.

= Requirements =

* A Verploy account — app.verploy.com
* WordPress 5.8 or higher, PHP 7.4 or higher
* For tested updates: a MySQL or MariaDB database and write access for WordPress to its own files

== Installation ==

1. Install and activate the plugin.
2. In the Verploy dashboard, add the site and click **Create pairing code**.
3. In WordPress go to **Settings → Verploy**, paste the code and click **Connect**. The code is valid for 30 minutes and works once.

== Frequently Asked Questions ==

= Does this plugin slow down my site? =

No. Health data is sent every 15 minutes in the background via WordPress cron.

= Where is the staging copy stored? =

In `wp-content/verploy-staging/` and in database tables with the prefix `vpst`. It is only reachable with a secret token, sends no e-mail, is not indexed, and is removed after every update. Backups for rollback (`wp-content/verploy-backups/`, tables with prefix `vpbk`) are removed after 7 days.

= How does the one-click login work? =

Verploy sends your browser to this site with a signed login token (HMAC-SHA256 with the per-site secret). The token is valid for at most 60 seconds, works once, only for this site at this address (not for a clone or staging copy) and only for an existing administrator. Like any password-less login, it bypasses a two-factor plugin on this site; turn it off if that is not acceptable. No passwords are stored or sent. Every login is listed under Settings → Verploy (who, as which administrator, when and from which IP address), and you can turn the feature off there.

= What happens if I remove the plugin? =

All Verploy settings, staging copies and backups are removed.

== Changelog ==

= 2.5.0 =
* One-click login to WP Admin from Verploy: a signed, single-use token valid for 60 seconds, only for an existing administrator. Can be turned off under Settings → Verploy; every login is logged there.
* The health data now includes the list of administrators (user name and display name, at most 20) and whether one-click login is on.

= 2.4.0 =
* Functional tests on the staging copy: forms (Contact Form 7, Gravity Forms, WPForms) and the WooCommerce cart and checkout are tested before and after an update. During these tests the staging copy blocks all outgoing requests, so a test submission never reaches a CRM, mailing list or payment provider. Email was already disabled on staging.

= 2.3.0 =
* Premium plugins and themes licensed per domain: the update package is fetched by the live site (with its licence) and the exact same package is tested on the staging copy and then deployed.

= 2.2.0 =
* Diagnosis data after a failed test: fatal errors are recorded during the update and made available to Verploy.

= 2.1.0 =
* Tested updates: staging copy, update, snapshot, maintenance mode, automatic rollback (also when the update crashes the whole site), cleanup.

= 2.0.0 =
* Pairing with a one-time code; all requests signed with HMAC-SHA256.

== Upgrade Notice ==

= 2.4.0 =
Adds functional tests of forms and the shop on the staging copy, with all outgoing requests blocked during those tests.

= 2.3.0 =
Safe updates for premium plugins and themes that only update on their licensed domain.

= 2.2.0 =
Adds diagnosis data for failed updates.
