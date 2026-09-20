<?php
/**
 * Sends a health snapshot to Verploy's cloud every 15 minutes via WP-Cron.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Verploy_Heartbeat {

	public static function init(): void {
		add_action( 'verploy_heartbeat', [ __CLASS__, 'send' ] );
	}

	public static function send(): void {
		$api_key = get_option( 'verploy_api_key' );
		if ( ! $api_key ) return;

		$client  = new Verploy_API_Client( $api_key );
		$payload = Verploy_Health_Collector::collect();

		$response = $client->post( '/sites/heartbeat', $payload );

		// Store last heartbeat time and result for admin UI
		update_option( 'verploy_last_heartbeat', [
			'timestamp' => gmdate( 'c' ),
			'success'   => ! is_wp_error( $response ),
			'error'     => is_wp_error( $response ) ? $response->get_error_message() : null,
		], false );
	}
}
