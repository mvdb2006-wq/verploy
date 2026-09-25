<?php
/**
 * Plugin Name:       Verploy Connector
 * Plugin URI:        https://app.verploy.com
 * Description:       Verbindt deze WordPress-site met Verploy: health-monitoring en veilige, geteste updates voor webbureaus.
 * Version:           2.5.2
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Verploy
 * Author URI:        https://app.verploy.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       verploy-connector
 *
 * @package VerployConnector
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VERPLOY_VERSION', '2.5.2' );
define( 'VERPLOY_PLUGIN_FILE', __FILE__ );
define( 'VERPLOY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
// Te overschrijven in wp-config.php voor lokale ontwikkeling en tests.
if ( ! defined( 'VERPLOY_API_BASE' ) ) {
	define( 'VERPLOY_API_BASE', 'https://app.verploy.com/api/v2' );
}

require_once VERPLOY_PLUGIN_DIR . 'includes/class-signer.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-connection.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-api-client.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-health-collector.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-heartbeat.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-rest-endpoints.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-admin.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-budget.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-file-copier.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-table-copier.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-run-lock.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-run-engine.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-sso.php';

Verploy_Heartbeat::init();
Verploy_Rest_Endpoints::init();
Verploy_Sso::init();
add_action( 'init', array( 'Verploy_Run_Engine', 'maybe_block_request' ), 0 );
if ( is_admin() ) {
	Verploy_Admin::init();
}
// Alleen in de direct-build (niet op WordPress.org): updates via app.verploy.com.
if ( file_exists( VERPLOY_PLUGIN_DIR . 'includes/class-updater.php' ) ) {
	require_once VERPLOY_PLUGIN_DIR . 'includes/class-updater.php';
	Verploy_Updater::init();
}

register_activation_hook( __FILE__, 'verploy_activate' );
register_deactivation_hook( __FILE__, 'verploy_deactivate' );

function verploy_activate() {
	delete_option( 'verploy_api_key' ); // 1.x-sleutels zijn ingetrokken.
	Verploy_Heartbeat::ensure_scheduled();
}

function verploy_deactivate() {
	wp_clear_scheduled_hook( Verploy_Heartbeat::HOOK );
	wp_clear_scheduled_hook( Verploy_Heartbeat::HOOK_SOON );
}
