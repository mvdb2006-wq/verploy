<?php
/**
 * Plugin Name: Verploy Connector
 * Plugin URI:  https://verploy.com
 * Description: Connects your WordPress site to Verploy — automated update testing, server health monitoring, and client reporting for agencies.
 * Version:     1.0.0
 * Author:      Verploy
 * Author URI:  https://verploy.com
 * License:     GPL-2.0-or-later
 * Text Domain: verploy-connector
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VERPLOY_VERSION',    '1.0.0' );
define( 'VERPLOY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'VERPLOY_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'VERPLOY_API_BASE',   'https://api.verploy.com/v1' );

// ─── Autoload ─────────────────────────────────────────────────────────────────
require_once VERPLOY_PLUGIN_DIR . 'includes/class-api-client.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-health-collector.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-rest-endpoints.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-admin.php';
require_once VERPLOY_PLUGIN_DIR . 'includes/class-heartbeat.php';

// ─── Bootstrap ────────────────────────────────────────────────────────────────
function verploy_init() {
	Verploy_REST_Endpoints::init();
	Verploy_Heartbeat::init();

	if ( is_admin() ) {
		Verploy_Admin::init();
	}
}
add_action( 'init', 'verploy_init' );

// ─── Activation / Deactivation ────────────────────────────────────────────────
register_activation_hook( __FILE__, 'verploy_activate' );
register_deactivation_hook( __FILE__, 'verploy_deactivate' );

function verploy_activate() {
	// Schedule heartbeat every 15 minutes
	if ( ! wp_next_scheduled( 'verploy_heartbeat' ) ) {
		wp_schedule_event( time(), 'verploy_15min', 'verploy_heartbeat' );
	}

	// Flush rewrite rules for REST endpoints
	flush_rewrite_rules();
}

function verploy_deactivate() {
	wp_clear_scheduled_hook( 'verploy_heartbeat' );

	// Notify Verploy cloud that site disconnected
	$api_key = get_option( 'verploy_api_key' );
	if ( $api_key ) {
		$client = new Verploy_API_Client( $api_key );
		$client->post( '/sites/disconnect', [ 'site_url' => get_site_url() ] );
	}
}

// Register custom cron interval
add_filter( 'cron_schedules', function( $schedules ) {
	$schedules['verploy_15min'] = [
		'interval' => 900,
		'display'  => __( 'Every 15 minutes', 'verploy-connector' ),
	];
	return $schedules;
} );
