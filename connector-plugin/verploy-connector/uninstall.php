<?php
/**
 * Ruimt alle Verploy-gegevens op bij het verwijderen van de plugin.
 *
 * @package VerployConnector
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'verploy_site_id', 'verploy_secret', 'verploy_paired_at', 'verploy_last_heartbeat', 'verploy_api_key', 'verploy_last_heartbeat_legacy' ) as $verploy_option ) {
	delete_option( $verploy_option );
}
delete_transient( 'verploy_update_info' );
wp_clear_scheduled_hook( 'verploy_heartbeat' );
