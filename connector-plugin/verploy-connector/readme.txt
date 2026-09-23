=== Verploy Connector ===
Contributors:      verploy
Tags:              maintenance, updates, monitoring, agency, wordpress
Requires at least: 5.8
Tested up to:      6.8
Requires PHP:      7.4
Stable tag:        2.0.0
License:           GPL-2.0-or-later
License URI:       https://www.gnu.org/licenses/gpl-2.0.html

Connects your WordPress site to Verploy — automated update testing, server health monitoring, and white-label client reports for agencies.

== Description ==

**Verploy** is the site intelligence platform for WordPress agencies. Install this lightweight connector plugin on each client site to unlock:

* **Automated update testing** — Before any plugin, theme, or core update goes live, Verploy clones the site to a staging environment and runs automated browser tests. If something breaks, the update is blocked.
* **Visual regression detection** — Side-by-side screenshots before and after every update catch layout regressions before your client sees them.
* **Server health monitoring** — PHP version, MySQL version, memory limits, OPcache status, SSL certificate expiry — all tracked automatically.
* **AI-powered failure diagnosis** — When a test fails, Verploy's AI explains what broke and how to fix it.
* **White-label monthly reports** — Professional PDF reports in your client's language, with your agency branding, sent automatically each month.

This plugin acts as the secure bridge between your WordPress site and the Verploy cloud platform. It sends health data, receives update commands, and enables real-time monitoring — all authenticated with your unique API key.

= Privacy =

This plugin sends site health data (WordPress version, plugin list, server configuration) to Verploy's servers at api.verploy.com. No personal visitor data is collected or transmitted. See [verploy.com/privacy](https://verploy.com/privacy) for the full privacy policy.

= Requirements =

* A Verploy account — [sign up at verploy.com](https://verploy.com)
* WordPress 5.8 or higher
* PHP 7.4 or higher

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/verploy-connector` directory, or install through the WordPress Plugins screen.
2. Activate the plugin through the **Plugins** screen.
3. Go to **Settings → Verploy** and paste your API key (found in your Verploy dashboard under Settings → Sites → Add site).
4. Click **Test connection** to confirm everything is working.

== Frequently Asked Questions ==

= Does this plugin slow down my site? =

No. The plugin sends health data to Verploy every 15 minutes via WordPress cron — this runs in the background and has no impact on page load times for visitors.

= Is my data secure? =

All communication between the plugin and Verploy's API uses HTTPS with Bearer token authentication. Your API key is stored in the WordPress options table and never exposed publicly.

= Can I use this without a Verploy account? =

No. This plugin requires an active Verploy account. [Create one at verploy.com](https://verploy.com).

= What data does the plugin send? =

The plugin sends: WordPress version, active plugins and themes (names, versions, update availability), PHP and MySQL versions, server configuration (memory limits, OPcache status), SSL certificate expiry, and site URL. No visitor data or content is ever transmitted.

== Changelog ==

= 1.0.0 =
* Initial release.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
