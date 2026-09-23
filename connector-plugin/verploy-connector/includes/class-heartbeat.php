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

		$is_error    = is_wp_error( $response );
		$pending_jobs = [];

		if ( ! $is_error && ! empty( $response['pending_jobs'] ) ) {
			$pending_jobs = $response['pending_jobs'];
		}

		// Store last heartbeat time and result for admin UI
		update_option( 'verploy_last_heartbeat', [
			'timestamp'    => gmdate( 'c' ),
			'success'      => ! $is_error,
			'error'        => $is_error ? $response->get_error_message() : null,
			'pending_jobs' => count( $pending_jobs ),
		], false );

		// Execute any pending update jobs returned by the cloud
		if ( ! empty( $pending_jobs ) ) {
			Verploy_Job_Runner::run( $pending_jobs, $api_key );
		}
	}
}
