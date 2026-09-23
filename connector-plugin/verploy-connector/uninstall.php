<?php
/**
 * Ruimt alle Verploy-gegevens op bij het verwijderen van de plugin.
 *
 * @package VerployConnector
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'verploy_site_id', 'verploy_secret', 'verploy_paired_at', 'verploy_last_heartbeat', 'verploy_api_key', 'verploy_last_heartbeat_legacy', 'verploy_run_lock', 'verploy_run_state', 'verploy_maintenance' ) as $verploy_option ) {
	delete_option( $verploy_option );
}
delete_transient( 'verploy_update_info' );
wp_clear_scheduled_hook( 'verploy_heartbeat' );

// Tijdelijke run-bestanden en -tabellen (staging, backups, rollback-noodroute).
$verploy_mu = ( defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : WP_CONTENT_DIR . '/mu-plugins' ) . '/verploy-rescue.php';
if ( is_file( $verploy_mu ) ) {
	@unlink( $verploy_mu ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
}
require_once __DIR__ . '/includes/class-file-copier.php';
require_once __DIR__ . '/includes/class-table-copier.php';
foreach ( array( 'verploy-staging', 'verploy-backups' ) as $verploy_dir ) {
	Verploy_File_Copier::delete_tree( WP_CONTENT_DIR . '/' . $verploy_dir );
}
global $wpdb;
$verploy_tables = $wpdb->get_col( "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ( LEFT(TABLE_NAME, 4) = 'vpst' OR LEFT(TABLE_NAME, 4) = 'vpbk' )" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
foreach ( (array) $verploy_tables as $verploy_table ) {
	if ( preg_match( '/^vp(st|bk)[0-9a-f]{8}_[A-Za-z0-9_]+$/', $verploy_table ) ) {
		$wpdb->query( 'DROP TABLE IF EXISTS ' . Verploy_Table_Copier::quote( $verploy_table ) ); // phpcs:ignore WordPress.DB
	}
}
